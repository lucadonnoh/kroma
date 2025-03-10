# Contract Upgrades

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**

- [Overview](#overview)
- [Upgrade By Governance](#upgrade-by-governance)
  - [Interface](#interface)
- [Emergency Upgrade](#emergency-upgrade)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->


## Overview

[Smart contract upgrades](https://docs.openzeppelin.com/upgrades-plugins/1.x/proxies) are executed through the 
[governance](https://docs.openzeppelin.com/contracts/4.x/api/governance) of the Security Council. The 
authority to perform proxy upgrades lies with the Security Council's governor.

There are two primary types of contract upgrades:

- 30-Day Timelock Delay Upgrade
- Emergency Upgrade 
  
Typically, when a proposal for an upgrade is approved, it undergoes a mandatory 30-day timelock delay period before 
execution. However, in cases where an urgent upgrade is necessary due to security concerns, the Security Council 
retains the capability to conduct an emergency upgrade.

## Upgrade By Governance

When an on-chain proposal for a contract upgrade is submitted by a member of Security Council, the member votes on the
proposal during the voting period. Once a proposal is approved, the Security Council queues the proposal to the batch
to be executed with a 30-day timelock. After the timelock delay, the upgrade can be executed. 

### Interface

```solidity
/**
     * @dev Create a new proposal. Vote start after a delay specified by {IGovernor-votingDelay} and lasts for a
     * duration specified by {IGovernor-votingPeriod}.
     *
     * Emits a {ProposalCreated} event.
     */
    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) public virtual returns (uint256 proposalId);

/**
 * @dev Cast a vote
     *
     * Emits a {VoteCast} event.
     */
    function castVote(uint256 proposalId, uint8 support) public virtual returns (uint256 balance);

/**
     * @notice Function to queue a proposal to the timelock.
     *         Added protocol for using custom time-lock zero delay for urgent situations.
     *
     * @param _targets         The destination address that send the message to.
     * @param _values          Amount of ether sent with the message.
     * @param _calldatas       The data portion of the message.
     * @param _descriptionHash A hashed form of the description string.
     *
     * @return Whether the challenge was canceled.
     */
    function queue(
        address[] memory _targets,
        uint256[] memory _values,
        bytes[] memory _calldatas,
        bytes32 _descriptionHash
    ) public virtual override returns (uint256);

/**
 * @dev Execute a successful proposal. This requires the quorum to be reached, the vote to be successful, and the
     * deadline to be reached.
     *
     * Emits a {ProposalExecuted} event.
     *
     * Note: some module can modify the requirements for execution, for example by adding an additional timelock.
     */
    function execute(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) public payable virtual returns (uint256 proposalId);
```

## Emergency Upgrade

When an immediate upgrade is required for security concerns, the Security Council has the authority to perform an 
emergency upgrade, which can be executed immediately once the voting period has ended. To propose an immediate upgrade 
through governance, a member of Security Council would set the target address and value of the first transaction to be 
executed.

```solidity
function queue(
        address[] memory _targets,
        uint256[] memory _values,
        bytes[] memory _calldatas,
        bytes32 _descriptionHash
    ) public virtual override returns (uint256) {
        // ...
    
        uint256 delay = _timelock.getMinDelay();
        // Protocol for reflecting urgent decisions on proposals.
        // A zero delay is applied if the first element of the argument satisfies conditions.
        if (_targets[0] == address(0) && _values[0] == 0) {
            delay = 0;
        }
    
        // ...
    }
```
