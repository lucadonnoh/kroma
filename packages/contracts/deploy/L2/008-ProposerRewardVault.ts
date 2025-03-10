import '@kroma/hardhat-deploy-config'
import '@nomiclabs/hardhat-ethers'
import { ethers } from 'ethers'
import { DeployFunction } from 'hardhat-deploy/dist/types'

import { assertContractVariable, deploy } from '../../src/deploy-utils'

const deployFn: DeployFunction = async (hre) => {
  const l1 = hre.network.companionNetworks['l1']
  const deployConfig = hre.getDeployConfig(l1)

  const proposerRewardVaultRecipient = deployConfig.proposerRewardVaultRecipient
  if (proposerRewardVaultRecipient === ethers.constants.AddressZero) {
    throw new Error('ProposerRewardVault RECIPIENT zero address')
  }

  await deploy(hre, 'ProposerRewardVault', {
    args: [proposerRewardVaultRecipient],
    isProxyImpl: true,
    postDeployAction: async (contract) => {
      await assertContractVariable(
        contract,
        'RECIPIENT',
        ethers.utils.getAddress(proposerRewardVaultRecipient)
      )
    },
  })
}

deployFn.tags = ['ProposerRewardVault', 'l2']

export default deployFn
