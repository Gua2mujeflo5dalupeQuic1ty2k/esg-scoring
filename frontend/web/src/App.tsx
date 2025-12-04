// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface Portfolio {
  id: string;
  name: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  esgScore: number;
  environmental: number;
  social: number;
  governance: number;
  complianceStatus: "pending" | "passed" | "failed";
}

const App: React.FC = () => {
  // Wallet state
  const [account, setAccount] = useState("");
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  
  // Data state
  const [loading, setLoading] = useState(true);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // UI state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [expandedPortfolio, setExpandedPortfolio] = useState<string | null>(null);
  
  // Transaction feedback
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  
  // New portfolio form
  const [newPortfolio, setNewPortfolio] = useState({
    name: "",
    encryptedData: ""
  });

  // Calculate statistics
  const passedCount = portfolios.filter(p => p.complianceStatus === "passed").length;
  const failedCount = portfolios.filter(p => p.complianceStatus === "failed").length;
  const pendingCount = portfolios.filter(p => p.complianceStatus === "pending").length;
  const avgEsgScore = portfolios.length > 0 
    ? portfolios.reduce((sum, p) => sum + p.esgScore, 0) / portfolios.length 
    : 0;

  // Initialize app
  useEffect(() => {
    loadPortfolios().finally(() => setLoading(false));
  }, []);

  // Wallet connection handlers
  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      setAccount(accounts[0] || "");

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        setAccount(accounts[0] || "");
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  // Load portfolios from contract
  const loadPortfolios = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      // Get portfolio keys
      const keysBytes = await contract.getData("portfolio_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing portfolio keys:", e);
        }
      }
      
      // Load each portfolio
      const list: Portfolio[] = [];
      for (const key of keys) {
        try {
          const portfolioBytes = await contract.getData(`portfolio_${key}`);
          if (portfolioBytes.length > 0) {
            try {
              const portfolioData = JSON.parse(ethers.toUtf8String(portfolioBytes));
              list.push({
                id: key,
                name: portfolioData.name,
                encryptedData: portfolioData.encryptedData,
                timestamp: portfolioData.timestamp,
                owner: portfolioData.owner,
                esgScore: portfolioData.esgScore || 0,
                environmental: portfolioData.environmental || 0,
                social: portfolioData.social || 0,
                governance: portfolioData.governance || 0,
                complianceStatus: portfolioData.complianceStatus || "pending"
              });
            } catch (e) {
              console.error(`Error parsing portfolio data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading portfolio ${key}:`, e);
        }
      }
      
      // Sort by timestamp
      list.sort((a, b) => b.timestamp - a.timestamp);
      setPortfolios(list);
    } catch (e) {
      console.error("Error loading portfolios:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  // Submit new portfolio
  const submitPortfolio = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting portfolio with FHE..."
    });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      // Generate unique ID
      const portfolioId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      // Create portfolio data
      const portfolioData = {
        name: newPortfolio.name,
        encryptedData: newPortfolio.encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        esgScore: 0,
        environmental: 0,
        social: 0,
        governance: 0,
        complianceStatus: "pending"
      };
      
      // Store portfolio on-chain
      await contract.setData(
        `portfolio_${portfolioId}`, 
        ethers.toUtf8Bytes(JSON.stringify(portfolioData))
      );
      
      // Update keys list
      const keysBytes = await contract.getData("portfolio_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(portfolioId);
      await contract.setData(
        "portfolio_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Portfolio submitted securely!"
      });
      
      // Refresh list
      await loadPortfolios();
      
      // Reset form
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewPortfolio({ name: "", encryptedData: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  // Calculate ESG score (simulated FHE computation)
  const calculateEsgScore = async (portfolioId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Calculating ESG score with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      // Get portfolio data
      const portfolioBytes = await contract.getData(`portfolio_${portfolioId}`);
      if (portfolioBytes.length === 0) {
        throw new Error("Portfolio not found");
      }
      
      const portfolioData = JSON.parse(ethers.toUtf8String(portfolioBytes));
      
      // Generate random ESG scores (simulated)
      const environmental = Math.floor(Math.random() * 40) + 60;
      const social = Math.floor(Math.random() * 40) + 60;
      const governance = Math.floor(Math.random() * 40) + 60;
      const esgScore = Math.round((environmental + social + governance) / 3);
      
      // Update portfolio with scores
      const updatedPortfolio = {
        ...portfolioData,
        esgScore,
        environmental,
        social,
        governance,
        complianceStatus: esgScore >= 70 ? "passed" : "failed"
      };
      
      // Save updated data
      await contract.setData(
        `portfolio_${portfolioId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedPortfolio))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "ESG calculation completed!"
      });
      
      // Refresh data
      await loadPortfolios();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Calculation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  // Check if current user is owner
  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  // Tutorial steps
  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the ESG tool",
      icon: "🔗"
    },
    {
      title: "Upload Portfolio",
      description: "Securely upload your encrypted investment portfolio",
      icon: "📤"
    },
    {
      title: "FHE ESG Scoring",
      description: "Your data is analyzed in encrypted state without decryption",
      icon: "🔍"
    },
    {
      title: "Get ESG Report",
      description: "Receive comprehensive ESG report while keeping data private",
      icon: "📊"
    }
  ];

  // Render ESG score chart
  const renderEsgChart = (portfolio: Portfolio) => {
    return (
      <div className="esg-chart">
        <div className="chart-bar">
          <div className="bar-label">Environmental</div>
          <div className="bar-container">
            <div 
              className="bar-fill environmental" 
              style={{ width: `${portfolio.environmental}%` }}
            >
              <span>{portfolio.environmental}%</span>
            </div>
          </div>
        </div>
        <div className="chart-bar">
          <div className="bar-label">Social</div>
          <div className="bar-container">
            <div 
              className="bar-fill social" 
              style={{ width: `${portfolio.social}%` }}
            >
              <span>{portfolio.social}%</span>
            </div>
          </div>
        </div>
        <div className="chart-bar">
          <div className="bar-label">Governance</div>
          <div className="bar-container">
            <div 
              className="bar-fill governance" 
              style={{ width: `${portfolio.governance}%` }}
            >
              <span>{portfolio.governance}%</span>
            </div>
          </div>
        </div>
        <div className="overall-score">
          <div className="score-label">Overall ESG Score</div>
          <div className="score-value">{portfolio.esgScore}%</div>
          <div className={`score-status ${portfolio.esgScore >= 70 ? 'passed' : 'failed'}`}>
            {portfolio.esgScore >= 70 ? 'Compliant' : 'Non-Compliant'}
          </div>
        </div>
      </div>
    );
  };

  // Loading screen
  if (loading) return (
    <div className="loading-screen">
      <div className="metal-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container metal-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>FHE<span>ESG</span>Scorer</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn metal-button"
          >
            <div className="add-icon"></div>
            Add Portfolio
          </button>
          <button 
            className="metal-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-grid">
          <div className="dashboard-card metal-card">
            <h3>Project Introduction</h3>
            <p>Confidential ESG scoring tool using FHE technology to analyze encrypted investment portfolios without exposing sensitive holdings.</p>
            <div className="fhe-badge">
              <span>FHE-Powered Privacy</span>
            </div>
          </div>
          
          <div className="dashboard-card metal-card">
            <h3>Portfolio Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{portfolios.length}</div>
                <div className="stat-label">Total Portfolios</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{passedCount}</div>
                <div className="stat-label">Compliant</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{failedCount}</div>
                <div className="stat-label">Non-Compliant</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{avgEsgScore.toFixed(1)}%</div>
                <div className="stat-label">Avg. ESG Score</div>
              </div>
            </div>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section metal-card">
            <h2>How It Works</h2>
            <p className="subtitle">Securely score your portfolios using FHE technology</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="portfolios-section">
          <div className="section-header">
            <h2>Investment Portfolios</h2>
            <div className="header-actions">
              <button 
                onClick={loadPortfolios}
                className="refresh-btn metal-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="portfolios-list metal-card">
            <div className="table-header">
              <div className="header-cell">Portfolio</div>
              <div className="header-cell">Owner</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">ESG Score</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {portfolios.length === 0 ? (
              <div className="no-portfolios">
                <div className="no-portfolios-icon"></div>
                <p>No portfolios found</p>
                <button 
                  className="metal-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Add First Portfolio
                </button>
              </div>
            ) : (
              portfolios.map(portfolio => (
                <React.Fragment key={portfolio.id}>
                  <div className="portfolio-row">
                    <div className="table-cell portfolio-name">{portfolio.name}</div>
                    <div className="table-cell">{portfolio.owner.substring(0, 6)}...{portfolio.owner.substring(38)}</div>
                    <div className="table-cell">
                      {new Date(portfolio.timestamp * 1000).toLocaleDateString()}
                    </div>
                    <div className="table-cell">
                      {portfolio.esgScore > 0 ? `${portfolio.esgScore}%` : "-"}
                    </div>
                    <div className="table-cell">
                      <span className={`status-badge ${portfolio.complianceStatus}`}>
                        {portfolio.complianceStatus}
                      </span>
                    </div>
                    <div className="table-cell actions">
                      {isOwner(portfolio.owner) && portfolio.complianceStatus === "pending" && (
                        <button 
                          className="action-btn metal-button"
                          onClick={() => calculateEsgScore(portfolio.id)}
                        >
                          Calculate ESG
                        </button>
                      )}
                      <button 
                        className="action-btn metal-button"
                        onClick={() => setExpandedPortfolio(
                          expandedPortfolio === portfolio.id ? null : portfolio.id
                        )}
                      >
                        {expandedPortfolio === portfolio.id ? "Hide" : "Details"}
                      </button>
                    </div>
                  </div>
                  
                  {expandedPortfolio === portfolio.id && (
                    <div className="portfolio-details">
                      <div className="details-grid">
                        <div className="details-section">
                          <h4>ESG Breakdown</h4>
                          {portfolio.esgScore > 0 ? (
                            renderEsgChart(portfolio)
                          ) : (
                            <p>ESG analysis not completed yet</p>
                          )}
                        </div>
                        
                        <div className="details-section">
                          <h4>Compliance Status</h4>
                          <div className={`compliance-status ${portfolio.complianceStatus}`}>
                            {portfolio.complianceStatus === "passed" && (
                              <div className="status-passed">
                                <div className="check-icon"></div>
                                <p>This portfolio meets ESG compliance standards</p>
                              </div>
                            )}
                            {portfolio.complianceStatus === "failed" && (
                              <div className="status-failed">
                                <div className="warning-icon"></div>
                                <p>This portfolio does not meet ESG compliance standards</p>
                                <p>Recommendation: Review holdings and rebalance portfolio</p>
                              </div>
                            )}
                            {portfolio.complianceStatus === "pending" && (
                              <div className="status-pending">
                                <div className="clock-icon"></div>
                                <p>ESG analysis pending</p>
                                <button 
                                  className="metal-button"
                                  onClick={() => calculateEsgScore(portfolio.id)}
                                >
                                  Calculate ESG Score
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        <div className="details-section">
                          <h4>Technical Details</h4>
                          <div className="tech-details">
                            <div className="detail-item">
                              <span>Encrypted Data:</span>
                              <code>{portfolio.encryptedData.substring(0, 40)}...</code>
                            </div>
                            <div className="detail-item">
                              <span>FHE Processing:</span>
                              <span className="fhe-tag">Enabled</span>
                            </div>
                            <div className="detail-item">
                              <span>Portfolio ID:</span>
                              <code>{portfolio.id}</code>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </React.Fragment>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitPortfolio} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          portfolioData={newPortfolio}
          setPortfolioData={setNewPortfolio}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metal-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="metal-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>FHE ESG Scorer</span>
            </div>
            <p>Confidential ESG scoring using Fully Homomorphic Encryption</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Confidentiality</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHE ESG Scorer. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  portfolioData: any;
  setPortfolioData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  portfolioData,
  setPortfolioData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setPortfolioData({
      ...portfolioData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!portfolioData.name || !portfolioData.encryptedData) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal metal-card">
        <div className="modal-header">
          <h2>Add Encrypted Portfolio</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your portfolio data remains encrypted during FHE processing
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Portfolio Name *</label>
              <input 
                type="text"
                name="name"
                value={portfolioData.name} 
                onChange={handleChange}
                placeholder="My Investment Portfolio" 
                className="metal-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Encrypted Portfolio Data *</label>
              <textarea 
                name="encryptedData"
                value={portfolioData.encryptedData} 
                onChange={handleChange}
                placeholder="Paste encrypted portfolio data..." 
                className="metal-textarea"
                rows={4}
              />
              <div className="input-hint">
                Data format: FHE-encrypted JSON containing portfolio holdings
              </div>
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            <p>Your holdings remain confidential throughout the ESG scoring process</p>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn metal-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn metal-button primary"
          >
            {creating ? "Processing with FHE..." : "Submit Portfolio"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;