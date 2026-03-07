#!/bin/bash

# Flatten MockPolicyClient for manual verification on BEAM explorer

echo "Flattening MockPolicyClient.sol..."

npx hardhat flatten contracts/mocks/MockPolicyClient.sol > MockPolicyClient_flat.sol

echo "✅ Flattened contract saved to: MockPolicyClient_flat.sol"
echo ""
echo "📋 Contract Details for Manual Verification:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Contract Address: 0xFd7ad3deF7768f0b69F4d2cA0Cea094d715b0583"
echo "Explorer URL: https://subnets-test.avax.network/beam/address/0xFd7ad3deF7768f0b69F4d2cA0Cea094d715b0583"
echo "Compiler Version: v0.8.24+commit.e11b9ed9"
echo "Optimization: Enabled (200 runs)"
echo "Contract Name: MockPolicyClient"
echo "License: MIT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📝 Steps to verify manually:"
echo "1. Visit the explorer URL above"
echo "2. Click 'Contract' tab → 'Verify & Publish'"
echo "3. Enter the details shown above"
echo "4. Copy and paste the content from MockPolicyClient_flat.sol"
echo "5. Submit for verification"
echo ""
echo "💡 Tip: Remove duplicate SPDX license comments if the explorer complains"
