window.SIDEBAR_ITEMS = {"constant":[["DAY",""],["DAY_I80F48",""],["FEE_BUYBACK_QUOTE_TOKEN_INDEX","The token index used in AccountBuybackFeesWithMngo to exchange for MNGO"],["FREE_ORDER_SLOT",""],["HOUR",""],["INSURANCE_TOKEN_INDEX","The token index used for the insurance fund."],["MAX_BANKS",""],["MAX_NUM_EVENTS",""],["MAX_ORDERTREE_NODES",""],["MINIMUM_MAX_RATE",""],["PERP_SETTLE_TOKEN_INDEX","The token index used for settling perp markets."],["QUOTE_DECIMALS",""],["QUOTE_NATIVE_TO_UI",""],["QUOTE_TOKEN_INDEX","This token index is supposed to be the token that oracles quote in."],["YEAR_I80F48",""]],"enum":[["BookSideOrderTree",""],["EventType",""],["IxGate","Enum for lookup into ix gate note: total ix files 56, ix files included 48, ix files not included 8,"],["NodeTag",""],["OracleType",""],["OrderParams",""],["OrderState",""],["OrderTreeType",""],["PlaceOrderType",""],["PostOrderType",""],["Side",""],["SideAndOrderTree","SideAndOrderTree is a storage optimization, so we don’t need two bytes for the data"]],"fn":[["compute_equity",""],["determine_oracle_type",""],["fixed_price_data","Creates price data for a fixed order’s price"],["fixed_price_lots","Retrieves the price (in lots) from a fixed order’s price data"],["new_node_key","Creates a binary tree node key."],["oracle_pegged_price_data","Creates price data for an oracle pegged order from the price offset"],["oracle_pegged_price_offset","Retrieves the price offset (in lots) from an oracle pegged order’s price data"],["oracle_price_and_slot","Returns the price of one native base token, in native quote tokens"],["power_of_ten",""],["rank_orders","Compares the `fixed` and `oracle_pegged` order and returns the one that would match first."]],"macro":[["account_seeds",""],["bank_seeds",""],["group_seeds",""],["serum_market_seeds",""]],"mod":[["switchboard_v1_devnet_oracle",""],["switchboard_v2_mainnet_oracle",""]],"struct":[["AnyEvent",""],["AnyNode",""],["Bank",""],["BookSide",""],["BookSideIter","Iterates the fixed and oracle_pegged OrderTrees simultaneously, allowing users to walk the orderbook without caring about where an order came from."],["BookSideIterItem",""],["BookSideOrderHandle","Reference to a node in a book side component"],["DynamicAccount",""],["EventQueue",""],["EventQueueHeader",""],["FillEvent",""],["FreeNode",""],["Group",""],["InnerNode","InnerNodes and LeafNodes compose the binary tree of orders."],["LeafNode","LeafNodes represent an order in the binary tree"],["MangoAccount",""],["MangoAccountDynamicHeader",""],["MangoAccountFixed",""],["MintInfo",""],["OracleConfig",""],["OracleConfigParams",""],["Order","Perp order parameters"],["OrderTreeIter","Iterate over orders in order (bids=descending, asks=ascending)"],["OrderTreeNodes","A binary tree on AnyNode::key()"],["OrderTreeRoot",""],["Orderbook",""],["OutEvent",""],["PerpMarket",""],["PerpOpenOrder",""],["PerpPosition",""],["Serum3Market",""],["Serum3MarketIndexReservation",""],["Serum3Orders",""],["StablePriceModel","Maintains a “stable_price” based on the oracle price."],["StubOracle",""],["TokenPosition",""]],"trait":[["DerefOrBorrow",""],["DerefOrBorrowMut",""],["DynamicHeader","Header is created by scanning and parsing the dynamic portion of the account. This stores useful information e.g. offsets to easily seek into dynamic content."],["MangoAccountLoader","Trait to allow a AccountLoader to create an accessor for the full account."],["QueueHeader",""]],"type":[["MangoAccountLoadedRef","Useful when loading from bytes"],["MangoAccountLoadedRefCell","Useful when loading from RefCell, like from AccountInfo"],["MangoAccountLoadedRefCellMut","Useful when loading from RefCell, like from AccountInfo"],["MangoAccountRef","Full reference type, useful for borrows"],["MangoAccountRefMut","Full reference type, useful for borrows"],["MangoAccountValue","Fully owned MangoAccount, useful for tests"],["NodeHandle",""],["PerpMarketIndex",""],["Serum3MarketIndex",""],["TokenIndex",""]]};