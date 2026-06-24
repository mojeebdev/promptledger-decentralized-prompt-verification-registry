// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * PromptLedger - Decentralized Prompt Verification Registry
 * 
 * Deploy to 0G Testnet (chainId 16602)
 * RPC: https://evmrpc-testnet.0g.ai
 * Explorer: https://chainscan-galileo.0g.ai
 */
contract PromptLedger {
    
    struct PromptRecord {
        bytes32 parentHash;
        bytes32 storageRoot;
        uint8 score;
        address submitter;
        uint256 timestamp;
        bool exists;
    }
    
    // Prompt hash => record
    mapping(bytes32 => PromptRecord) public prompts;
    
    // All prompt hashes (for enumeration)
    bytes32[] public allPromptHashes;
    
    // Events
    event PromptAnchored(
        bytes32 indexed promptHash,
        address indexed submitter,
        uint8 score,
        uint256 blockNumber
    );
    
    event PromptRevised(
        bytes32 indexed promptHash,
        bytes32 indexed parentHash,
        address indexed submitter,
        uint8 score
    );
    
    /**
     * Anchor a prompt's hash and score on-chain
     * 
     * @param promptHash   SHA-256 hash of the prompt text
     * @param parentHash   Hash of the parent version (zero for v1)
     * @param storageRoot  Root hash of the 0G Storage record
     * @param score        Score out of 15
     */
    function anchorPrompt(
        bytes32 promptHash,
        bytes32 parentHash,
        bytes32 storageRoot,
        uint8 score
    ) external {
        require(!prompts[promptHash].exists, "Prompt already anchored");
        require(score <= 15, "Score exceeds maximum (15)");
        
        // If parent hash is non-zero, verify parent exists
        if (parentHash != bytes32(0)) {
            require(prompts[parentHash].exists, "Parent prompt not found");
        }
        
        prompts[promptHash] = PromptRecord({
            parentHash: parentHash,
            storageRoot: storageRoot,
            score: score,
            submitter: msg.sender,
            timestamp: block.timestamp,
            exists: true
        });
        
        allPromptHashes.push(promptHash);
        
        if (parentHash == bytes32(0)) {
            emit PromptAnchored(promptHash, msg.sender, score, block.number);
        } else {
            emit PromptRevised(promptHash, parentHash, msg.sender, score);
        }
    }
    
    /**
     * Get a prompt record by hash
     */
    function getPrompt(bytes32 promptHash) external view returns (
        bytes32 parentHash,
        bytes32 storageRoot,
        uint8 score,
        address submitter,
        uint256 timestamp,
        bool exists
    ) {
        PromptRecord memory record = prompts[promptHash];
        return (
            record.parentHash,
            record.storageRoot,
            record.score,
            record.submitter,
            record.timestamp,
            record.exists
        );
    }
    
    /**
     * Get total number of anchored prompts
     */
    function getTotalPrompts() external view returns (uint256) {
        return allPromptHashes.length;
    }
    
    /**
     * Get prompt hash by index
     */
    function getPromptHashByIndex(uint256 index) external view returns (bytes32) {
        require(index < allPromptHashes.length, "Index out of bounds");
        return allPromptHashes[index];
    }
    
    /**
     * Get the full version chain for a prompt
     * Walks back from the given hash to v1
     */
    function getVersionChain(bytes32 promptHash) external view returns (bytes32[] memory) {
        // Count chain length
        uint256 length = 0;
        bytes32 current = promptHash;
        while (current != bytes32(0)) {
            length++;
            current = prompts[current].parentHash;
        }
        
        // Build chain array
        bytes32[] memory chain = new bytes32[](length);
        current = promptHash;
        for (uint256 i = 0; i < length; i++) {
            chain[i] = current;
            current = prompts[current].parentHash;
        }
        
        return chain;
    }
}
