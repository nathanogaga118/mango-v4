import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import cloneDeep from 'lodash/cloneDeep';
import { TokenIndex } from './accounts/bank';
import { Group } from './accounts/group';
import { HealthType, MangoAccount } from './accounts/mangoAccount';
import { MangoClient } from './client';
import { I80F48, ONE_I80F48, ZERO_I80F48 } from './numbers/I80F48';
import { toUiDecimals, toUiDecimalsForQuote } from './utils';

async function buildFetch(): Promise<
  (
    input: RequestInfo | URL,
    init?: RequestInit | undefined,
  ) => Promise<Response>
> {
  let fetch = globalThis?.fetch;
  if (!fetch && process?.versions?.node) {
    fetch = (await import('node-fetch')).default;
  }
  return fetch;
}

export interface LiqorPriceImpact {
  Coin: { val: string };
  'Oracle Price': { val: number };
  'On-Chain Price': { val: number };
  'Future Price': { val: number };
  'V4 Liq Fee': { val: number };
  Liabs: { val: number };
  'Liabs Slippage': { val: number };
  Assets: { val: number };
  'Assets Slippage': { val: number };
}

export interface PerpPositionsToBeLiquidated {
  Market: { val: string };
  Price: { val: number };
  'Future Price': { val: number };
  'Notional Position': { val: number };
}

export interface AccountEquity {
  Account: { val: PublicKey };
  Equity: { val: number };
}

export interface Risk {
  assetRally: { title: string; data: LiqorPriceImpact[] };
  assetDrop: { title: string; data: LiqorPriceImpact[] };
  usdcDepeg: { title: string; data: LiqorPriceImpact[] };
  usdtDepeg: { title: string; data: LiqorPriceImpact[] };
  perpRally: { title: string; data: PerpPositionsToBeLiquidated[] };
  perpDrop: { title: string; data: PerpPositionsToBeLiquidated[] };
  marketMakerEquity: { title: string; data: AccountEquity[] };
  liqorEquity: { title: string; data: AccountEquity[] };
}

export async function computePriceImpactOnJup(
  amount: string,
  inputMint: string,
  outputMint: string,
): Promise<{ outAmount: number; priceImpactPct: number }> {
  const url = `https://quote-api.jup.ag/v4/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&swapMode=ExactIn&slippageBps=10000&onlyDirectRoutes=false&asLegacyTransaction=false`;
  const response = await (await buildFetch())(url);

  try {
    const res = await response.json();
    if (res['data'] && res.data.length > 0 && res.data[0].outAmount) {
      return {
        outAmount: parseFloat(res.data[0].outAmount),
        priceImpactPct: parseFloat(res.data[0].priceImpactPct),
      };
    } else {
      return {
        outAmount: -1 / 10000,
        priceImpactPct: -1 / 10000,
      };
    }
  } catch (e) {
    console.log(e);
    throw e;
  }
}

export async function getPriceImpactForLiqor(
  group: Group,
  mangoAccounts: MangoAccount[],
): Promise<LiqorPriceImpact[]> {
  const mangoAccountsWithHealth = mangoAccounts.map((a: MangoAccount) => {
    return {
      account: a,
      health: a.getHealth(group, HealthType.liquidationEnd),
      healthRatio: a.getHealthRatioUi(group, HealthType.liquidationEnd),
      liabs: toUiDecimalsForQuote(
        a.getLiabsValue(group, HealthType.liquidationEnd),
      ),
    };
  });

  const usdcBank = group.getFirstBankByTokenIndex(0 as TokenIndex);
  const usdcMint = usdcBank.mint;

  return await Promise.all(
    Array.from(group.banksMapByMint.values())
      .sort((a, b) => a[0].name.localeCompare(b[0].name))
      .map(async (banks) => {
        const bank = banks[0];

        // Sum of all liabs, these liabs would be acquired by liqor,
        // who would immediately want to reduce them to 0
        // Assuming liabs need to be bought using USDC
        const liabs =
          // Max liab of a particular token that would be liquidated to bring health above 0
          mangoAccountsWithHealth.reduce((sum, a) => {
            // How much would health increase for every unit liab moved to liqor
            // liabprice * (liabweight - (1+fee)*assetweight)
            const tokenLiabHealthContrib = bank.price.mul(
              bank.initLiabWeight.sub(
                ONE_I80F48()
                  .add(bank.liquidationFee)
                  .mul(usdcBank.initAssetWeight),
              ),
            );
            // Abs liab/borrow
            const maxTokenLiab = a.account
              .getEffectiveTokenBalance(group, bank)
              .min(ZERO_I80F48())
              .abs();

            if (tokenLiabHealthContrib.eq(ZERO_I80F48())) {
              return sum.add(maxTokenLiab);
            }

            // Health under 0
            const maxLiab = a.health
              .min(ZERO_I80F48())
              .abs()
              .div(tokenLiabHealthContrib)
              .min(maxTokenLiab);

            return sum.add(maxLiab);
          }, ZERO_I80F48());
        const liabsInUsdc =
          // convert to usdc, this is an approximation
          liabs
            .mul(bank.price)
            .floor()
            // jup oddity
            .min(I80F48.fromNumber(99999999999));

        // Sum of all assets which would be acquired in exchange for also acquiring
        // liabs by the liqor, who would immediately want to reduce to 0
        // Assuming assets need to be sold to USDC
        const assets = mangoAccountsWithHealth.reduce((sum, a) => {
          // How much would health increase for every unit liab moved to liqor
          // assetprice * (liabweight/(1+liabliqfee) - assetweight)
          const liabBank = Array.from(group.banksMapByTokenIndex.values())
            .flat()
            .reduce((prev, curr) =>
              prev.initLiabWeight.lt(curr.initLiabWeight) ? prev : curr,
            );
          const tokenAssetHealthContrib = bank.price.mul(
            liabBank.initLiabWeight
              .div(ONE_I80F48().add(liabBank.liquidationFee))
              .sub(bank.initAssetWeight),
          );

          // Abs collateral/asset
          const maxTokenHealthAsset = a.account
            .getEffectiveTokenBalance(group, bank)
            .max(ZERO_I80F48());

          if (tokenAssetHealthContrib.eq(ZERO_I80F48())) {
            return sum.add(maxTokenHealthAsset);
          }

          const maxAsset = a.health
            .min(ZERO_I80F48())
            .abs()
            .div(tokenAssetHealthContrib)
            .min(maxTokenHealthAsset);

          return sum.add(maxAsset);
        }, ZERO_I80F48());

        let data;
        data = await (
          await buildFetch()
        )(`https://price.jup.ag/v4/price?ids=${bank.mint}`);
        data = await data.json();
        data = data['data'];

        const [onChainPrice, pi1, pi2] = await Promise.all([
          data[bank.mint.toBase58()]['price'],

          !liabsInUsdc.eq(ZERO_I80F48())
            ? computePriceImpactOnJup(
                liabsInUsdc.toString(),
                usdcMint.toBase58(),
                bank.mint.toBase58(),
              )
            : Promise.resolve({ priceImpactPct: 0, outAmount: 0 }),

          !assets.eq(ZERO_I80F48())
            ? computePriceImpactOnJup(
                assets.floor().toString(),
                bank.mint.toBase58(),
                usdcMint.toBase58(),
              )
            : Promise.resolve({ priceImpactPct: 0, outAmount: 0 }),
        ]);

        return {
          Coin: { val: bank.name },
          'Oracle Price': {
            val: bank['oldUiPrice'] ? bank['oldUiPrice'] : bank._uiPrice!,
          },
          'On-Chain Price': { val: onChainPrice },
          'Future Price': { val: bank._uiPrice! },
          'V4 Liq Fee': {
            val: Math.round(bank.liquidationFee.toNumber() * 10000),
          },
          Liabs: { val: Math.round(toUiDecimalsForQuote(liabsInUsdc)) },
          'Liabs Slippage': { val: Math.round(pi1.priceImpactPct * 10000) },
          Assets: {
            val: Math.round(
              toUiDecimals(assets, bank.mintDecimals) * bank.uiPrice,
            ),
          },
          'Assets Slippage': { val: Math.round(pi2.priceImpactPct * 10000) },
        };
      }),
  );
}

export async function getPerpPositionsToBeLiquidated(
  group: Group,
  mangoAccounts: MangoAccount[],
): Promise<PerpPositionsToBeLiquidated[]> {
  const mangoAccountsWithHealth = mangoAccounts.map((a: MangoAccount) => {
    return {
      account: a,
      health: a.getHealth(group, HealthType.liquidationEnd),
      healthRatio: a.getHealthRatioUi(group, HealthType.liquidationEnd),
      liabs: toUiDecimalsForQuote(
        a.getLiabsValue(group, HealthType.liquidationEnd),
      ),
    };
  });

  return Array.from(group.perpMarketsMapByMarketIndex.values())
    .filter((pm) => !pm.name.includes('OLD'))
    .map((pm) => {
      const baseLots = mangoAccountsWithHealth
        .filter((a) => a.account.getPerpPosition(pm.perpMarketIndex))
        .reduce((sum, a) => {
          const baseLots = a.account.getPerpPosition(
            pm.perpMarketIndex,
          )!.basePositionLots;
          const unweightedHealthPerLot = baseLots.gt(new BN(0))
            ? I80F48.fromNumber(-1)
                .mul(pm.price)
                .mul(I80F48.fromU64(pm.baseLotSize))
                .mul(pm.initBaseAssetWeight)
                .add(
                  I80F48.fromU64(pm.baseLotSize)
                    .mul(pm.price)
                    .mul(
                      ONE_I80F48() // quoteInitAssetWeight
                        .mul(ONE_I80F48().sub(pm.baseLiquidationFee)),
                    ),
                )
            : pm.price
                .mul(I80F48.fromU64(pm.baseLotSize))
                .mul(pm.initBaseLiabWeight)
                .sub(
                  I80F48.fromU64(pm.baseLotSize)
                    .mul(pm.price)
                    .mul(ONE_I80F48()) // quoteInitLiabWeight
                    .mul(ONE_I80F48().add(pm.baseLiquidationFee)),
                );

          const maxBaseLots = a.health
            .min(ZERO_I80F48())
            .abs()
            .div(unweightedHealthPerLot.abs())
            .min(I80F48.fromU64(baseLots).abs());

          return sum.add(maxBaseLots);
        }, ONE_I80F48());

      const notionalPositionUi = toUiDecimalsForQuote(
        baseLots.mul(I80F48.fromU64(pm.baseLotSize).mul(pm.price)),
      );

      return {
        Market: { val: pm.name },
        Price: { val: pm['oldUiPrice'] },
        'Future Price': { val: pm._uiPrice },
        'Notional Position': { val: Math.round(notionalPositionUi) },
      };
    });
}

export async function getEquityForMangoAccounts(
  client: MangoClient,
  group: Group,
  mangoAccounts: PublicKey[],
): Promise<AccountEquity[]> {
  // Filter mango accounts which might be closed
  const liqors = (
    await client.connection.getMultipleAccountsInfo(mangoAccounts)
  )
    .map((ai, i) => {
      return { ai: ai, pk: mangoAccounts[i] };
    })
    .filter((val) => val.ai)
    .map((val) => val.pk);

  const liqorMangoAccounts = await Promise.all(
    liqors.map((liqor) => client.getMangoAccount(liqor, true)),
  );

  const accountsWithEquity = liqorMangoAccounts.map((a: MangoAccount) => {
    return {
      Account: { val: a.publicKey },
      Equity: { val: Math.round(toUiDecimalsForQuote(a.getEquity(group))) },
    };
  });
  accountsWithEquity.sort((a, b) => b.Equity.val - a.Equity.val);
  return accountsWithEquity;
}

export async function getRiskStats(
  client: MangoClient,
  group: Group,
  change = 0.4, // simulates 40% price rally and price drop on tokens and markets
): Promise<Risk> {
  // Get known liqors
  let liqors: PublicKey[];
  try {
    liqors = (
      await (
        await (
          await buildFetch()
        )(
          `https://api.mngo.cloud/data/v4/stats/liqors-over_period?over_period=1MONTH`,
        )
      ).json()
    ).map((data) => new PublicKey(data['liqor']));
  } catch (error) {
    liqors = [];
  }

  // Get known mms
  const mms = [
    new PublicKey('CtHuPg2ctVVV7nqmvVEcMtcWyJAgtZw9YcNHFQidjPgF'),
    new PublicKey('F1SZxEDxxCSLVjEBbMEjDYqajWRJQRCZBwPQnmcVvTLV'),
    new PublicKey('BGYWnqfaauCeebFQXEfYuDCktiVG8pqpprrsD4qfqL53'),
    new PublicKey('9XJt2tvSZghsMAhWto1VuPBrwXsiimPtsTR8XwGgDxK2'),
  ];

  // Get all mango accounts
  const mangoAccounts = await client.getAllMangoAccounts(group, true);

  // Clone group, and simulate change % price drop for all assets except stables
  const drop = 1 - change;
  const groupDrop: Group = cloneDeep(group);
  Array.from(groupDrop.banksMapByTokenIndex.values())
    .flat()
    .filter((b) => !b.name.includes('USD'))
    .forEach((b) => {
      b['oldUiPrice'] = b._uiPrice;
      b._uiPrice = b._uiPrice! * drop;
      b._price = b._price?.mul(I80F48.fromNumber(drop));
    });
  Array.from(groupDrop.perpMarketsMapByMarketIndex.values()).forEach((p) => {
    p['oldUiPrice'] = p._uiPrice;
    p._uiPrice = p._uiPrice! * drop;
    p._price = p._price?.mul(I80F48.fromNumber(drop));
  });

  // Clone group, and simulate change % price drop for usdc
  const groupUsdcDepeg: Group = cloneDeep(group);
  Array.from(groupDrop.banksMapByTokenIndex.values())
    .flat()
    .filter((b) => b.name.includes('USDC'))
    .forEach((b) => {
      b['oldUiPrice'] = b._uiPrice;
      b._uiPrice = b._uiPrice! * drop;
      b._price = b._price?.mul(I80F48.fromNumber(drop));
    });

  // Clone group, and simulate change % price drop for usdt
  const groupUsdtDepeg: Group = cloneDeep(group);
  Array.from(groupDrop.banksMapByTokenIndex.values())
    .flat()
    .filter((b) => b.name.includes('USDT'))
    .forEach((b) => {
      b['oldUiPrice'] = b._uiPrice;
      b._uiPrice = b._uiPrice! * drop;
      b._price = b._price?.mul(I80F48.fromNumber(drop));
    });

  // Clone group, and simulate change % price rally for all assets except stables
  const rally = 1 + change;
  const groupRally: Group = cloneDeep(group);
  Array.from(groupRally.banksMapByTokenIndex.values())
    .flat()
    .filter((b) => !b.name.includes('USD'))
    .forEach((b) => {
      b['oldUiPrice'] = b._uiPrice;
      b._uiPrice = b._uiPrice! * rally;
      b._price = b._price?.mul(I80F48.fromNumber(rally));
    });
  Array.from(groupRally.perpMarketsMapByMarketIndex.values()).forEach((p) => {
    p['oldUiPrice'] = p._uiPrice;
    p._uiPrice = p._uiPrice! * rally;
    p._price = p._price?.mul(I80F48.fromNumber(rally));
  });

  const [
    assetDrop,
    assetRally,
    usdcDepeg,
    usdtDepeg,
    perpDrop,
    perpRally,
    liqorEquity,
    marketMakerEquity,
  ] = await Promise.all([
    getPriceImpactForLiqor(groupDrop, mangoAccounts),
    getPriceImpactForLiqor(groupRally, mangoAccounts),
    getPriceImpactForLiqor(groupUsdcDepeg, mangoAccounts),
    getPriceImpactForLiqor(groupUsdtDepeg, mangoAccounts),
    getPerpPositionsToBeLiquidated(groupDrop, mangoAccounts),
    getPerpPositionsToBeLiquidated(groupRally, mangoAccounts),
    getEquityForMangoAccounts(client, group, liqors),
    getEquityForMangoAccounts(client, group, mms),
  ]);

  return {
    assetDrop: {
      title: `Table 1a: Liqors acquire liabs and assets. The assets and liabs are sum of max assets and max
    liabs for any token which would be liquidated to fix the health of a mango account.
    This would be the slippage they would face on buying-liabs/offloading-assets tokens acquired from unhealth accounts after a 40% drop to all non-stable oracles`,
      data: assetDrop,
    },
    assetRally: {
      title: `Table 1b: ... same as above with a 40% rally to all non-stable oracles instead of drop`,
      data: assetRally,
    },
    usdcDepeg: {
      title: `Table 1c: ... same as above with a 40% drop to only usdc oracle`,
      data: usdcDepeg,
    },
    usdtDepeg: {
      title: `Table 1d: ... same as above with a 40% drop to only usdt oracle`,
      data: usdtDepeg,
    },
    perpDrop: {
      title: `Table 2a: Perp notional that liqor need to liquidate after a  40% drop`,
      data: perpDrop,
    },
    perpRally: {
      title: `Table 2b: Perp notional that liqor need to liquidate after a  40% rally`,
      data: perpRally,
    },
    liqorEquity: {
      title: `Table 3: Equity of known liqors from last month`,
      data: liqorEquity,
    },
    marketMakerEquity: {
      title: `Table 4: Equity of known makers from last month`,
      data: marketMakerEquity,
    },
  };
}
