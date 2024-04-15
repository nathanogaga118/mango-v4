use super::*;
use anchor_lang::prelude::AccountMeta;

#[tokio::test]
async fn test_liq_perps_force_cancel() -> Result<(), TransportError> {
    let test_builder = TestContextBuilder::new();
    let context = test_builder.start_default().await;
    let solana = &context.solana.clone();

    let admin = TestKeypair::new();
    let owner = context.users[0].key;
    let payer = context.users[1].key;
    let mints = &context.mints[0..2];
    let payer_mint_accounts = &context.users[1].token_accounts[0..2];

    //
    // SETUP: Create a group and an account to fill the vaults
    //

    let GroupWithTokens { group, tokens, .. } = GroupWithTokensConfig {
        admin,
        payer,
        mints: mints.to_vec(),
        ..GroupWithTokensConfig::default()
    }
    .create(solana)
    .await;
    //let quote_token = &tokens[0];
    let base_token = &tokens[1];

    // deposit some funds, to the vaults aren't empty
    create_funded_account(&solana, group, owner, 0, &context.users[1], mints, 10000, 0).await;

    //
    // TEST: Create a perp market
    //
    let mango_v4::accounts::PerpCreateMarket { perp_market, .. } = send_tx(
        solana,
        PerpCreateMarketInstruction {
            group,
            admin,
            payer,
            perp_market_index: 0,
            quote_lot_size: 10,
            base_lot_size: 100,
            maint_base_asset_weight: 0.8,
            init_base_asset_weight: 0.6,
            maint_base_liab_weight: 1.2,
            init_base_liab_weight: 1.4,
            base_liquidation_fee: 0.05,
            maker_fee: 0.0,
            taker_fee: 0.0,
            settle_pnl_limit_factor: 0.2,
            settle_pnl_limit_window_size_ts: 24 * 60 * 60,
            ..PerpCreateMarketInstruction::with_new_book_and_queue(&solana, base_token).await
        },
    )
    .await
    .unwrap();

    let price_lots = {
        let perp_market = solana.get_account::<PerpMarket>(perp_market).await;
        perp_market.native_price_to_lot(I80F48::ONE)
    };

    //
    // SETUP: Make an account and deposit some quote and base
    //
    let deposit_amount = 1000;
    let account = create_funded_account(
        &solana,
        group,
        owner,
        1,
        &context.users[1],
        &mints[0..1],
        deposit_amount,
        0,
    )
    .await;

    send_tx(
        solana,
        TokenDepositInstruction {
            amount: 1,
            reduce_only: false,
            account,
            owner,
            token_account: payer_mint_accounts[1],
            token_authority: payer,
            bank_index: 0,
        },
    )
    .await
    .unwrap();

    //
    // SETUP: Place a perp order
    //
    send_tx(
        solana,
        PerpPlaceOrderInstruction {
            account,
            perp_market,
            owner,
            side: Side::Ask,
            price_lots,
            // health was 1000 * 0.6 = 600; this order is -14*100*(1.4-1) = -560
            max_base_lots: 14,
            ..PerpPlaceOrderInstruction::default()
        },
    )
    .await
    .unwrap();

    //
    // SETUP: Change the oracle to make health go negative
    //
    set_bank_stub_oracle_price(solana, group, base_token, admin, 10.0).await;

    // verify health is bad: can't withdraw
    assert!(send_tx(
        solana,
        TokenWithdrawInstruction {
            amount: 1,
            allow_borrow: false,
            account,
            owner,
            token_account: payer_mint_accounts[1],
            bank_index: 0,
        }
    )
    .await
    .is_err());

    //
    // TEST: force cancel orders, making the account healthy again
    //
    send_tx(
        solana,
        PerpLiqForceCancelOrdersInstruction {
            account,
            perp_market,
        },
    )
    .await
    .unwrap();

    // can withdraw again
    send_tx(
        solana,
        TokenWithdrawInstruction {
            amount: 1,
            allow_borrow: false,
            account,
            owner,
            token_account: payer_mint_accounts[1],
            bank_index: 0,
        },
    )
    .await
    .unwrap();

    Ok(())
}

#[tokio::test]
async fn test_liq_perps_force_cancel_stale_oracle() -> Result<(), TransportError> {
    let mut test_builder = TestContextBuilder::new();
    test_builder.test().set_compute_max_units(150_000); // bad oracles log a lot
    let context = test_builder.start_default().await;
    let solana = &context.solana.clone();

    let admin = TestKeypair::new();
    let owner = context.users[0].key;
    let payer = context.users[1].key;
    let mints = &context.mints[0..2];
    let payer_mint_accounts = &context.users[1].token_accounts[0..2];

    //
    // SETUP: Create a group and an account to fill the vaults
    //

    let GroupWithTokens { group, tokens, .. } = GroupWithTokensConfig {
        admin,
        payer,
        mints: mints.to_vec(),
        ..GroupWithTokensConfig::default()
    }
    .create(solana)
    .await;
    //let quote_token = &tokens[0];
    let base_token = &tokens[1];

    // deposit some funds, to the vaults aren't empty
    create_funded_account(&solana, group, owner, 0, &context.users[1], mints, 10000, 0).await;

    //
    // TEST: Create a perp market
    //
    let mango_v4::accounts::PerpCreateMarket { perp_market, .. } = send_tx(
        solana,
        PerpCreateMarketInstruction {
            group,
            admin,
            payer,
            perp_market_index: 0,
            quote_lot_size: 10,
            base_lot_size: 100,
            maint_base_asset_weight: 0.8,
            init_base_asset_weight: 0.6,
            maint_base_liab_weight: 1.2,
            init_base_liab_weight: 1.4,
            base_liquidation_fee: 0.05,
            maker_fee: 0.0,
            taker_fee: 0.0,
            settle_pnl_limit_factor: 0.2,
            settle_pnl_limit_window_size_ts: 24 * 60 * 60,
            ..PerpCreateMarketInstruction::with_new_book_and_queue(&solana, base_token).await
        },
    )
    .await
    .unwrap();

    let price_lots = {
        let perp_market = solana.get_account::<PerpMarket>(perp_market).await;
        perp_market.native_price_to_lot(I80F48::ONE)
    };

    //
    // SETUP: Make an account and deposit some quote and base
    //
    let deposit_amount = 1000;
    let account = create_funded_account(
        &solana,
        group,
        owner,
        1,
        &context.users[1],
        &mints[0..1],
        deposit_amount,
        0,
    )
    .await;

    send_tx(
        solana,
        TokenDepositInstruction {
            amount: 1,
            reduce_only: false,
            account,
            owner,
            token_account: payer_mint_accounts[1],
            token_authority: payer,
            bank_index: 0,
        },
    )
    .await
    .unwrap();

    //
    // SETUP: Fallback oracle
    //
    let fallback_oracle_kp = TestKeypair::new();
    let fallback_oracle = fallback_oracle_kp.pubkey();
    send_tx(
        solana,
        StubOracleCreate {
            oracle: fallback_oracle_kp,
            group,
            mint: base_token.mint.pubkey,
            admin,
            payer,
        },
    )
    .await
    .unwrap();

    send_tx(
        solana,
        PerpAddFallbackOracle {
            group,
            admin,
            perp_market,
            fallback_oracle,
        },
    )
    .await
    .unwrap();

    send_tx(
        solana,
        TokenEdit {
            group,
            admin,
            mint: base_token.mint.pubkey,
            fallback_oracle,
            options: mango_v4::instruction::TokenEdit {
                set_fallback_oracle: true,
                ..token_edit_instruction_default()
            },
        },
    )
    .await
    .unwrap();

    //
    // SETUP: Place a perp order
    //
    send_tx(
        solana,
        PerpPlaceOrderInstruction {
            account,
            perp_market,
            owner,
            side: Side::Ask,
            price_lots,
            // health was 1000 * 0.6 = 600; this order is -14*100*(1.4-1) = -560
            max_base_lots: 14,
            ..PerpPlaceOrderInstruction::default()
        },
    )
    .await
    .unwrap();

    //
    // SETUP: Change the oracle to make health go negative, and invalid
    //
    send_tx(
        solana,
        StubOracleSetTestInstruction {
            oracle: base_token.oracle,
            group,
            mint: base_token.mint.pubkey,
            admin,
            price: 10.0,
            last_update_slot: 0,
            deviation: 100.0,
        },
    )
    .await;

    //
    // TEST: force cancel orders fails due to stale oracle
    //
    assert!(send_tx(
        solana,
        PerpLiqForceCancelOrdersInstruction {
            account,
            perp_market,
        },
    )
    .await
    .is_err());

    //
    // SETUP: Ensure fallback oracle matches default
    //
    send_tx(
        solana,
        StubOracleSetTestInstruction {
            oracle: fallback_oracle,
            group,
            mint: base_token.mint.pubkey,
            admin,
            price: 10.0,
            last_update_slot: 0,
            deviation: 0.0,
        },
    )
    .await;

    //
    // TEST: force cancel orders with fallback succeeds
    //
    let fallback_oracle_meta = AccountMeta {
        pubkey: fallback_oracle,
        is_writable: false,
        is_signer: false,
    };
    send_tx_with_extra_accounts(
        solana,
        PerpLiqForceCancelOrdersInstruction {
            account,
            perp_market,
        },
        vec![fallback_oracle_meta.clone()],
    )
    .await
    .unwrap();

    // Withdraw also fails due to stale oracle
    assert!(send_tx(
        solana,
        TokenWithdrawInstruction {
            amount: 1,
            allow_borrow: false,
            account,
            owner,
            token_account: payer_mint_accounts[1],
            bank_index: 0,
        },
    )
    .await
    .is_err());

    // can withdraw with fallback
    send_tx_with_extra_accounts(
        solana,
        TokenWithdrawInstruction {
            amount: 1,
            allow_borrow: false,
            account,
            owner,
            token_account: payer_mint_accounts[1],
            bank_index: 0,
        },
        vec![fallback_oracle_meta.clone()],
    )
    .await
    .unwrap();

    Ok(())
}
