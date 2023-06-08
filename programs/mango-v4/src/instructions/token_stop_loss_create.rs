use anchor_lang::prelude::*;

use crate::accounts_ix::*;
use crate::accounts_zerocopy::*;
use crate::error::*;
use crate::state::*;

#[allow(clippy::too_many_arguments)]
pub fn token_stop_loss_create(
    ctx: Context<AccountAndAuthority>,
    // TODO: args
) -> Result<()> {
    // TODO ix gate

    let mut account = ctx.accounts.account.load_full_mut()?;
    account.add_token_stop_loss()?;

    Ok(())
}
