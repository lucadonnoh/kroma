# L2 Execution Engine

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**

- [Deposited transaction processing](#deposited-transaction-processing)
  - [Deposited transaction boundaries](#deposited-transaction-boundaries)
- [Fees](#fees)
  - [Fee Vaults](#fee-vaults)
  - [Transaction Fees](#transaction-fees)
  - [Proposer Reward (Proposer Reward Vault)](#proposer-reward-proposer-reward-vault)
- [Engine API](#engine-api)
  - [`engine_forkchoiceUpdatedV1`](#engine_forkchoiceupdatedv1)
    - [Extended PayloadAttributesV1](#extended-payloadattributesv1)
  - [`engine_newPayloadV1`](#engine_newpayloadv1)
  - [`engine_getPayloadV1`](#engine_getpayloadv1)
- [Networking](#networking)
- [Sync](#sync)
  - [Happy-path sync](#happy-path-sync)
  - [Worst-case sync](#worst-case-sync)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

This document outlines the modifications, configuration and usage of a L1 execution engine for L2.

## Deposited transaction processing

The Engine interfaces abstract away transaction types with [EIP-2718][eip-2718].

To support rollup functionality, processing of a new Deposit [`TransactionType`][eip-2718-transactions]
is implemented by the engine, see the [deposits specification][deposit-spec].

This type of transaction can mint L2 ETH, run EVM,
and introduce L1 information to enshrined contracts in the execution state.

[deposit-spec]: deposits.md

### Deposited transaction boundaries

Transactions cannot be blindly trusted, trust is established through authentication.
Unlike other transaction types deposits are not authenticated by a signature:
the rollup node authenticates them, outside of the engine.

To process deposited transactions safely, the deposits MUST be authenticated first:

- Ingest directly through trusted Engine API.
- Part of sync towards a trusted block hash (trusted through previous Engine API instruction).

Deposited transactions MUST never be consumed from the transaction pool.
*The transaction pool can be disabled in a validator node or full node.*

## Fees

Sequenced transactions (i.e. not applicable to deposits) are charged with 2 types of fees:
transaction fees(priority fees + base fees), and proposer reward.

### Fee Vaults

The three types of fees are collected in 3 distinct L2 fee-vault deployments for accounting purposes:
fee payments are not registered as internal EVM calls, and thus distinguished better this way.

These are hardcoded addresses, pointing at pre-deployed proxy contracts.
The proxies are backed by vault contract deployments, based on `FeeVault`, to route vault funds to L1 securely.

| Vault Name             | Predeploy                                                      |
|------------------------|----------------------------------------------------------------|
| Validator Reward Vault | [`ValidatorRewardVault`](./predeploys.md#ValidatorRewardVault) |
| Protocol Vault         | [`ProtocolVault`](./predeploys.md#ProtocolVault)               |
| Proposer Reward Vault  | [`ProposerRewardVault`](./predeploys.md#ProposerRewardVault)   |

### Transaction Fees

Transaction fees in Kroma are different from [eip-1559] specification.
The Base Fee is not burned, and there is no distinction between Base Fee and Priority Fee.
The transaction fee is distributed to two vaults, Validator Reward Vault and Protocol Fee.

- Validator Reward Vault: `(baseFee + priorityFee) * (ValidatorRewardScalar / 10000)`
- Protocol Vault: `(baseFee + priorityFee) * (1 - ValidatorRewardScalar / 10000)`

`ValidatorRewardScalar` value is recorded in the [`L1Block`](./predeploys.md#L1block) contract.

### Proposer Reward (Proposer Reward Vault)

The protocol funds batch-submission of sequenced L2 transactions by charging L2 users an additional fee
based on the estimated batch-submission costs.
This fee is charged from the L2 transaction-sender ETH balance, and collected into the Proposer Reward Vault.

The exact L1 cost function to determine the L1-cost fee component of an L2 transaction is calculated as:
`(rollupDataGas + l1FeeOverhead) * l1Basefee * l1FeeScalar / 1000000`
(big-int computation, result in Wei and `uint256` range)
Where:

- `rollupDataGas` is determined from the *full* encoded transaction
  (standard EIP-2718 transaction encoding, including signature fields, which is `zeroes * 4 + ones * 16`).
- `l1FeeOverhead` is the Gas Price Oracle `overhead` value.
- `l1FeeScalar` is the Gas Price Oracle `scalar` value.
- `l1Basefee` is the L1 Base fee of the latest L1 origin registered in the L2 chain.

Note that the `rollupDataGas` uses the same byte cost accounting as defined in [eip-2028],
except the full L2 transaction now counts towards the bytes charged in the L1 calldata.

Compression, batching, and intrinsic gas costs of the batch transactions are accounted for by the protocol
with the Gas Price Oracle `overhead` and `scalar` parameters.

The Gas Price Oracle `l1FeeOverhead` and `l1FeeScalar`, as well as the `l1Basefee` of the L1 origin,
can be accessed in two interchangeable ways:

- read from the deposited L1 attributes (`l1FeeOverhead`, `l1FeeScalar`, `basefee`) of the current L2 block
- read from the L1 Block Info contract (`0x4200000000000000000000000000000000000002`)
  - using the respective solidity `uint256`-getter functions (`l1FeeOverhead`, `l1FeeScalar`, `basefee`)
  - using direct storage-reads:
    - L1 basefee as big-endian `uint256` in slot `1`
    - Overhead as big-endian `uint256` in slot `5`
    - Scalar as big-endian `uint256` in slot `6`

## Engine API

### `engine_forkchoiceUpdatedV1`

This updates which L2 blocks the engine considers to be canonical (`forkchoiceState` argument),
and optionally initiates block production (`payloadAttributes` argument).

Within the rollup, the types of forkchoice updates translate as:

- `headBlockHash`: block hash of the head of the canonical chain. Labeled `"unsafe"` in user JSON-RPC.
   Nodes may apply L2 blocks out of band ahead of time, and then reorg when L1 data conflicts.
- `safeBlockHash`: block hash of the canonical chain, derived from L1 data, unlikely to reorg.
- `finalizedBlockHash`: irreversible block hash, matches lower boundary of the dispute period.

To support rollup functionality, one backwards-compatible change is introduced
to [`engine_forkchoiceUpdatedV1`][engine_forkchoiceUpdatedV1]: the extended `PayloadAttributesV1`

#### Extended PayloadAttributesV1

[`PayloadAttributesV1`][PayloadAttributesV1] is extended to:

```js
PayloadAttributesV1: {
    timestamp: QUANTITY
    random: DATA (32 bytes)
    suggestedFeeRecipient: DATA (20 bytes)
    transactions: array of DATA
    noTxPool: bool
    gasLimit: QUANTITY or null
}
```

The type notation used here refers to the [HEX value encoding] used by the [Ethereum JSON-RPC API
specification][JSON-RPC-API], as this structure will need to be sent over JSON-RPC. `array` refers
to a JSON array.

Each item of the `transactions` array is a byte list encoding a transaction: `TransactionType ||
TransactionPayload` or `LegacyTransaction`, as defined in [EIP-2718][eip-2718].
This is equivalent to the `transactions` field in [`ExecutionPayloadV1`][ExecutionPayloadV1]

The `transactions` field is optional:

- If empty or missing: no changes to engine behavior. The proposers will (if enabled) build a block
  by consuming transactions from the transaction pool.
- If present and non-empty: the payload MUST be produced starting with this exact list of transactions.
  The [rollup driver][rollup-driver] determines the transaction list based on deterministic L1 inputs.

The `noTxPool` is optional as well, and extends the `transactions` meaning:

- If `false`, the execution engine is free to pack additional transactions from external sources like the tx pool
  into the payload, after any of the `transactions`. This is the default behavior a L1 node implements.
- If `true`, the execution engine must not change anything about the given list of `transactions`.

If the `transactions` field is present, the engine must execute the transactions in order and return `STATUS_INVALID`
if there is an error processing the transactions. It must return `STATUS_VALID` if all of the transactions could
be executed without error. **Note**: The state transition rules have been modified such that deposits will never fail
so if `engine_forkchoiceUpdatedV1` returns `STATUS_INVALID` it is because a batched transaction is invalid.

The `gasLimit` is optional w.r.t. compatibility with L1, but required when used as rollup.
This field overrides the gas limit used during block-building.
If not specified as rollup, a `STATUS_INVALID` is returned.

[rollup-driver]: rollup-node.md

### `engine_newPayloadV1`

No modifications to [`engine_newPayloadV1`][engine_newPayloadV1].
Applies a L2 block to the engine state.

### `engine_getPayloadV1`

No modifications to [`engine_getPayloadV1`][engine_getPayloadV1].
Retrieves a payload by ID, prepared by `engine_forkchoiceUpdatedV1` when called with `payloadAttributes`.

## Networking

The execution engine can acquire all data through the rollup node, as derived from L1:
*P2P networking is strictly optional.*

However, to not bottleneck on L1 data retrieval speed, the P2P network functionality SHOULD be enabled, serving:

- Peer discovery ([Disc v5][discv5])
- [`eth/66`][eth66]:
  - Transaction pool (consumed by proposer nodes)
  - State sync (happy-path for fast trustless db replication)
  - Historical block header and body retrieval
  - *New blocks are acquired through the consensus layer instead (rollup node)*

No modifications to L1 network functionality are required, except configuration:

- [`networkID`][network-id]: Distinguishes the L2 network from L1 and testnets.
  Equal to the [`chainID`][chain-id] of the rollup network.
- Activate Merge fork: Enables Engine API and disables propagation of blocks,
  as block headers cannot be authenticated without consensus layer.
- Bootnode list: DiscV5 is a shared network,
  [bootstrap][discv5-rationale] is faster through connecting with L2 nodes first.

[discv5]: https://github.com/ethereum/devp2p/blob/master/discv5/discv5.md
[eth66]: https://github.com/ethereum/devp2p/blob/master/caps/eth.md
[network-id]: https://github.com/ethereum/devp2p/blob/master/caps/eth.md#status-0x00
[chain-id]: https://github.com/ethereum/EIPs/blob/master/EIPS/eip-155.md
[discv5-rationale]: https://github.com/ethereum/devp2p/blob/master/discv5/discv5-rationale.md

## Sync

The execution engine can operate sync in different ways:

- Happy-path: rollup node informs engine of the desired chain head as determined by L1, completes through engine P2P.
- Worst-case: rollup node detects stalled engine, completes sync purely from L1 data, no peers required.

The happy-path is more suitable to bring new nodes online quickly,
as the engine implementation can sync state faster through methods like [snap-sync][snap-sync].

[snap-sync]: https://github.com/ethereum/devp2p/blob/master/caps/snap.md

### Happy-path sync

1. The rollup node informs the engine of the L2 chain head, unconditionally (part of regular node operation):
   - [`engine_newPayloadV1`][engine_newPayloadV1] is called with latest L2 block derived from L1.
   - [`engine_forkchoiceUpdatedV1`][engine_forkchoiceUpdatedV1] is called with the current
     `unsafe`/`safe`/`finalized` L2 block hashes.
2. The engine requests headers from peers, in reverse till the parent hash matches the local chain
3. The engine catches up:
    a) A form of state sync is activated towards the finalized or head block hash
    b) A form of block sync pulls block bodies and processes towards head block hash

The exact P2P based sync is out of scope for the L2 specification:
the operation within the engine is the exact same as with L1 (although with an EVM that supports deposits).

### Worst-case sync

1. Engine is out of sync, not peered and/or stalled due other reasons.
2. The rollup node maintains latest head from engine (poll `eth_getBlockByNumber` and/or maintain a header subscription)
3. The rollup node activates sync if the engine is out of sync but not syncing through P2P (`eth_syncing`)
4. The rollup node inserts blocks, derived from L1, one by one, potentially adapting to L1 reorg(s),
   as outlined in the [rollup node spec] (`engine_forkchoiceUpdatedV1`, `engine_newPayloadV1`)

[rollup node spec]: rollup-node.md

[eip-1559]: https://eips.ethereum.org/EIPS/eip-1559
[eip-2028]: https://eips.ethereum.org/EIPS/eip-2028
[eip-2718]: https://eips.ethereum.org/EIPS/eip-2718
[eip-2718-transactions]: https://eips.ethereum.org/EIPS/eip-2718#transactions
[PayloadAttributesV1]: https://github.com/ethereum/execution-apis/blob/769c53c94c4e487337ad0edea9ee0dce49c79bfa/src/engine/specification.md#PayloadAttributesV1
[ExecutionPayloadV1]: https://github.com/ethereum/execution-apis/blob/769c53c94c4e487337ad0edea9ee0dce49c79bfa/src/engine/specification.md#ExecutionPayloadV1
[engine_forkchoiceUpdatedV1]: https://github.com/ethereum/execution-apis/blob/769c53c94c4e487337ad0edea9ee0dce49c79bfa/src/engine/specification.md#engine_forkchoiceupdatedv1
[engine_newPayloadV1]: https://github.com/ethereum/execution-apis/blob/769c53c94c4e487337ad0edea9ee0dce49c79bfa/src/engine/specification.md#engine_newPayloadV1
[engine_getPayloadV1]: https://github.com/ethereum/execution-apis/blob/769c53c94c4e487337ad0edea9ee0dce49c79bfa/src/engine/specification.md#engine_getPayloadV1
[HEX value encoding]: https://eth.wiki/json-rpc/API#hex-value-encoding
[JSON-RPC-API]: https://github.com/ethereum/execution-apis
