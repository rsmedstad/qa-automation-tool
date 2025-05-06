// pages/index.js
// Dashboard displaying QA run data, ad-hoc test trigger, and AI assistant

import { useEffect, useState, useRef } from 'react';
import Chart from 'chart.js/auto';

export default function Dashboard() {
  const [runs, setRuns] = useState([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [testStatus, setTestStatus] = useState('');
  const chartRef = useRef(null);

  // Fetch run data on mount
  useEffect(() => {
    fetch('/api/get-runs')
      .then((res) => res.json())
      .then((data) => setRuns(data))
      .catch((err) => setError('Failed to load runs'));
  }, []);

  // Render chart when runs update
  useEffect(() => {
    if (runs.length > 0 && chartRef.current) {
      const ctx = chartRef.current.getContext('2d');
      new Chart(ctx, {
        type: 'bar',
        data: {
          labels: runs.map((run) => run.crawlName),
          datasets: [
            {
              label: 'Successful URLs',
              data: runs.map((run) => run.successCount),
              backgroundColor: 'rgba(75, 192, 192, 0.5)',
            },
            {
              label: 'Failed URLs',
              data: runs.map((run) => run.failureCount),
              backgroundColor: 'rgba(255, 99, 132, 0.5)',
            },
          ],
        },
        options: {
          scales: { y: { beginAtZero: true } },
          responsive: true,
          maintainAspectRatio: false,
        },
      });
    }
  }, [runs]);

  // Handle AI assistant submission
  const handleAskSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setAnswer('');

    try {
      const response = await fetch('/api/ask-llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const data = await response.json();
      if (response.ok) {
        setAnswer(data.answer);
      } else {
        setError(data.message || 'Something went wrong');
      }
    } catch (err) {
      setError('Failed to connect to the server');
    } finally {
      setLoading(false);
    }
  };

  // Handle ad-hoc test submission
  const handleTestSubmit = async (e) => {
    e.preventDefault();
    setTestStatus('Initiating test...');
    setError('');

    const formData = new FormData(e.target);
    const initiator = formData.get('initiator');
    const passphrase = formData.get('passphrase');
    const file = formData.get('file');

    const reader = new FileReader();
    reader.onload = async () => {
      const fileData = reader.result.split(',')[1]; // Get base64 data

      try {
        const response = await fetch('/api/trigger-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initiator, passphrase, file: fileData }),
        });
        const data = await response.json();
        if (response.ok) {
          setTestStatus('Test initiated! Check GitHub Actions for progress.');
        } else {
          setError(data.message || 'Failed to initiate test');
          setTestStatus('');
        }
      } catch (err) {
        setError('Failed to connect to the server');
        setTestStatus('');
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>QA Run Dashboard</h1>

      {/* Graph */}
      <div style={{ height: '300px', marginBottom: '20px' }}>
        <canvas ref={chartRef}></canvas>
      </div>

      {/* Table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px' }}>
        <thead>
          <tr style={{ backgroundColor: '#f2f2f2' }}>
            <th style={{ border: '1px solid #ddd', padding: '8px' }}>Crawl Name</th>
            <th style={{ border: '1px solid #ddd', padding: '8px' }}>Date</th>
            <th style={{ border: '1px solid #ddd', padding: '8px' }}>Initiator</th>
            <th style={{ border: '1px solid #ddd', padding: '8px' }}>Success</th>
            <th style={{ border: '1px solid #ddd', padding: '8px' }}>Failed</th>
            <th style={{ border: '1px solid #ddd', padding: '8px' }}>Artifacts</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.runId}>
              <td style={{ border: '1px solid #ddd', padding: '8px' }}>{run.crawlName}</td>
              <td style={{ border: '1px solid #ddd', padding: '8px' }}>
                {new Date(run.date).toLocaleString()}
              </td>
              <td style={{ border: '1px solid #ddd', padding: '8px' }}>{run.initiator}</td>
              <td style={{ border: '1px solid #ddd', padding: '8px' }}>{run.successCount}</td>
              <td style={{ border: '1px solid #ddd', padding: '8px' }}>{run.failureCount}</td>
              <td style={{ border: '1px solid #ddd', padding: '8px' }}>
                <a
                  href={`https://github.com/rsmedstad/gehc-cmc-testing/actions/runs/${run.runId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View Artifacts
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Ad-hoc Test Form */}
      <div style={{ border: '1px solid #ddd', padding: '10px', marginBottom: '20px' }}>
        <h2>Run Ad-hoc QA Test</h2>
        <form onSubmit={handleTestSubmit}>
          <input
            type="text"
            name="initiator"
            placeholder="Your Name"
            required
            style={{ width: '100%', padding: '8px', marginBottom: '10px' }}
          />
          <input
            type="password"
            name="passphrase"
            placeholder="Passphrase"
            required
            style={{ width: '100%', padding: '8px', marginBottom: '10px' }}
          />
          <input
            type="file"
            name="file"
            accept=".xlsx"
            required
            style={{ width: '100%', padding: '8px', marginBottom: '10px' }}
          />
          <button type="submit" style={{ padding: '8px 16px' }}>Run Test</button>
        </form>
        {testStatus && <p style={{ marginTop: '10px' }}>{testStatus}</p>}
      </div>

      {/* AI Assistant */}
      <div style={{ border: '1px solid #ddd', padding: '10px' }}>
        <h2>Ask the AI Assistant</h2>
        <form onSubmit={handleAskSubmit}>
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about test results or protocol (e.g., 'Summarize recent crawls')"
            style={{ width: '100%', padding: '8px', marginBottom: '10px' }}
          />
          <button
            type="submit"
            disabled={loading}
            style={{ padding: '8px 16px', cursor: loading ? 'not-allowed' : 'pointer' }}
          >
            {loading ? 'Loading...' : 'Ask'}
          </button>
        </form>
        {answer && (
          <p style={{ marginTop: '10px' }}>
            <strong>Answer:</strong> {answer}
          </p>
        )}
        {error && <p style={{ color: 'red', marginTop: '10px' }}>{error}</p>}
      </div>
    </div>
  );
}