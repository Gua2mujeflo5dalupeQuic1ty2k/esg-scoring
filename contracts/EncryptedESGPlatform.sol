// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract EncryptedESGPlatform is SepoliaConfig {
    struct EncryptedPortfolio {
        uint256 id;
        euint32 encryptedHoldings;   // Encrypted holdings
        euint32 encryptedESGScore;   // Encrypted ESG score
        uint256 timestamp;
    }

    struct DecryptedPortfolio {
        string holdingsSummary;
        uint32 esgScore;
        bool isDecrypted;
    }

    uint256 public portfolioCount;
    mapping(uint256 => EncryptedPortfolio) public encryptedPortfolios;
    mapping(uint256 => DecryptedPortfolio) public decryptedPortfolios;

    mapping(string => euint32) private encryptedESGCategoryCount;
    string[] private categoryList;

    mapping(uint256 => uint256) private requestToPortfolioId;

    event PortfolioSubmitted(uint256 indexed id, uint256 timestamp);
    event DecryptionRequested(uint256 indexed id);
    event PortfolioDecrypted(uint256 indexed id);

    modifier onlyOwner(uint256 portfolioId) {
        // Placeholder for ownership verification
        _;
    }

    /// @notice Submit an encrypted portfolio
    function submitEncryptedPortfolio(
        euint32 encryptedHoldings,
        euint32 encryptedESGScore
    ) public {
        portfolioCount += 1;
        uint256 newId = portfolioCount;

        encryptedPortfolios[newId] = EncryptedPortfolio({
            id: newId,
            encryptedHoldings: encryptedHoldings,
            encryptedESGScore: encryptedESGScore,
            timestamp: block.timestamp
        });

        decryptedPortfolios[newId] = DecryptedPortfolio({
            holdingsSummary: "",
            esgScore: 0,
            isDecrypted: false
        });

        emit PortfolioSubmitted(newId, block.timestamp);
    }

    /// @notice Request decryption of a portfolio
    function requestPortfolioDecryption(uint256 portfolioId) public onlyOwner(portfolioId) {
        EncryptedPortfolio storage portfolio = encryptedPortfolios[portfolioId];
        require(!decryptedPortfolios[portfolioId].isDecrypted, "Already decrypted");

        bytes32 ;
        ciphertexts[0] = FHE.toBytes32(portfolio.encryptedHoldings);
        ciphertexts[1] = FHE.toBytes32(portfolio.encryptedESGScore);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptPortfolio.selector);
        requestToPortfolioId[reqId] = portfolioId;

        emit DecryptionRequested(portfolioId);
    }

    /// @notice Callback to handle decrypted portfolio data
    function decryptPortfolio(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 portfolioId = requestToPortfolioId[requestId];
        require(portfolioId != 0, "Invalid request");

        EncryptedPortfolio storage ePortfolio = encryptedPortfolios[portfolioId];
        DecryptedPortfolio storage dPortfolio = decryptedPortfolios[portfolioId];
        require(!dPortfolio.isDecrypted, "Already decrypted");

        FHE.checkSignatures(requestId, cleartexts, proof);

        (string memory holdingsSummary, uint32 esgScore) = abi.decode(cleartexts, (string, uint32));

        dPortfolio.holdingsSummary = holdingsSummary;
        dPortfolio.esgScore = esgScore;
        dPortfolio.isDecrypted = true;

        emit PortfolioDecrypted(portfolioId);
    }

    /// @notice Get decrypted portfolio
    function getDecryptedPortfolio(uint256 portfolioId) public view returns (
        string memory holdingsSummary,
        uint32 esgScore,
        bool isDecrypted
    ) {
        DecryptedPortfolio storage p = decryptedPortfolios[portfolioId];
        return (p.holdingsSummary, p.esgScore, p.isDecrypted);
    }
}
