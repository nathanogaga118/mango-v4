use crate::error::*;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct TriggerActionExecute<'info> {
    #[account(
        // TODO: constraint = group.load()?.is_ix_enabled(IxGate::AccountCreate) @ MangoError::IxIsDisabled,
    )]
    pub group: AccountLoader<'info, Group>,

    #[account(
        has_one = group,
        // TODO: does this account always close on success?
    )]
    pub trigger_action: AccountLoader<'info, TriggerAction>,

    #[account(mut)]
    pub triggerer: Signer<'info>,

    pub system_program: Program<'info, System>,
    // Lots of remaining accounts for all the details
}
