/**
 * TokenFactory ABIs for decodeEventLog / decodeFunctionData.
 * Matches on-chain factory: TokenConfig { name, symbol, totalSupplyRaw }; TokenCreated only.
 */

export const TOKEN_FACTORY_EVENTS_ABI = [
  {
    type: "event",
    name: "TokenCreated",
    inputs: [
      { indexed: true, name: "creator", type: "address" },
      { indexed: true, name: "token", type: "address" },
    ],
  },
  {
    type: "event",
    name: "TokenDistributed",
    inputs: [
      { indexed: true, name: "token", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "label", type: "string" },
    ],
  },
];

const TOKEN_CONFIG_COMPONENTS = [
  { name: "name", type: "string" },
  { name: "symbol", type: "string" },
  { name: "totalSupplyRaw", type: "uint256" },
];

export const TOKEN_FACTORY_FUNCTIONS_ABI = [
  {
    type: "function",
    name: "createToken",
    stateMutability: "nonpayable",
    inputs: [{ name: "cfg", type: "tuple", components: TOKEN_CONFIG_COMPONENTS }],
    outputs: [{ name: "tokenAddr", type: "address" }],
  },
  {
    type: "function",
    name: "createTokenWithDistribution",
    stateMutability: "nonpayable",
    inputs: [
      { name: "cfg", type: "tuple", components: TOKEN_CONFIG_COMPONENTS },
      { name: "recipients", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
      { name: "labels", type: "string[]" },
    ],
    outputs: [{ name: "tokenAddr", type: "address" }],
  },
];
