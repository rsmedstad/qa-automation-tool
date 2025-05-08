import React, { useEffect, useState, useRef } from 'react';
import Chart from 'chart.js/auto';
import ReactMarkdown from 'react-markdown';
import remarkEmoji from 'remark-emoji';
import remarkGfm from 'remark-gfm';
import ChartDataLabels from 'chartjs-plugin-datalabels';

export default function Dashboard() {
  const [runs, setRuns] = useState([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [runsError, setRunsError] = useState('');
  const [geminiError, setGeminiError] = useState('');
  const [testStatus, setTestStatus] = useState('');
  const [readme, setReadme] = useState('');
  const [expandedRows, setExpandedRows] = useState([]);
  const [isTestDefsExpanded, setIsTestDefsExpanded] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [isGeminiEnabled, setIsGeminiEnabled] = useState(false);
  const [geminiPassphrase, setGeminiPassphrase] = useState('');
  const chartRef = useRef(null);
  const donutChartRef = useRef(null);

  const toggleRow = (runId) => {
    setExpandedRows((prev) =>
      prev.includes(runId) ? prev.filter((id) => id !== runId) : [...prev, runId]
    );
  };

  useEffect(() => {
    const fetchRuns = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/get-runs?cache_bust=${Date.now()}`, {
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        const data = await res.json();
        console.log('Fetched runs:', data);
        const sanitizedData = data.map((run, idx) => ({
          ...run,
          runId: run.runId || `fallback-${idx}`,
          hasArtifacts: run.hasArtifacts ?? false,
          artifactCount: run.artifactCount || 0,
        }));
        setRuns(sanitizedData);
      } catch (err) {
        console.error('Error fetching runs:', err);
        setRunsError('Failed to load runs: ' + err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchRuns();
  }, []);

  useEffect(() => {
    fetch('https://api.github.com/repos/rsmedstad/qa-automation-tool/readme')
      .then((res) => res.json())
      .then((data) => {
        const decoded = atob(data.content);
        const utf8Decoded = decodeURIComponent(escape(decoded));
        setReadme(utf8Decoded);
      })
      .catch((err) => console.error('Failed to fetch README', err));
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedMode = localStorage.getItem('darkMode');
      if (savedMode) {
        setIsDarkMode(savedMode === 'true');
      } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        setIsDarkMode(true);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (isDarkMode) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      localStorage.setItem('darkMode', isDarkMode);
    }
  }, [isDarkMode]);

  useEffect(() => {
    if (runs.length > 0 && chartRef.current) {
      const ctx = chartRef.current.getContext('2d');
      const sortedRuns = [...runs].sort((a, b) => new Date(a.date) - new Date(b.date));
      const labels = sortedRuns.map(run => {
        const date = new Date(run.date);
        return `${date.toLocaleDateString()}\n${date.toLocaleTimeString()}`;
      });
      const passedData = sortedRuns.map(run => run.successCount);
      const failedData = sortedRuns.map(run => run.failureCount);
      const naData = sortedRuns.map(run => run.naCount || 0);
      const maxUrls = Math.max(...sortedRuns.map(run => run.successCount + run.failureCount + (run.naCount || 0)));

      if (chartRef.current.chart) {
        chartRef.current.chart.destroy();
      }

      chartRef.current.chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            {
              label: '# Passed',
              data: passedData,
              backgroundColor: 'rgba(75, 192, 75, 0.5)',
            },
            {
              label: '# Failed',
              data: failedData,
              backgroundColor: 'rgba(255, 99, 132, 0.5)',
            },
            {
              label: '# N/A',
              data: naData,
              backgroundColor: 'rgba(255, 206, 86, 0.5)',
            },
          ],
        },
        options: {
          scales: {
            x: {
              stacked: true,
              ticks: {
                autoSkip: true,
                maxTicksLimit: 10,
                maxRotation: 45,
                minRotation: 45,
                callback: function(value, index, values) {
                  return labels[index].split('\n');
                },
              },
            },
            y: {
              stacked: true,
              beginAtZero: true,
              max: Math.ceil(maxUrls / 10) * 10 + 10,
              ticks: {
                stepSize: 1,
                precision: 0,
              },
              title: { display: true, text: 'Total URLs Crawled' },
            },
          },
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true },
            datalabels: {
              display: true,
              color: 'black',
              anchor: 'center',
              align: 'center',
              formatter: (value) => value,
            },
          },
        },
        plugins: [ChartDataLabels],
      });
    }
    return () => {
      if (chartRef.current?.chart) {
        chartRef.current.chart.destroy();
      }
    };
  }, [runs]);

  useEffect(() => {
    if (runs.length > 0 && donutChartRef.current) {
      const ctx = donutChartRef.current.getContext('2d');
      const scheduledCount = runs.filter(run => run.event === 'schedule').length;
      const adHocCount = runs.filter(run => run.event === 'workflow_dispatch').length;

      if (donutChartRef.current.chart) {
        donutChartRef.current.chart.destroy();
      }

      donutChartRef.current.chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Scheduled', 'Ad-Hoc'],
          datasets: [{ data: [scheduledCount, adHocCount], backgroundColor: ['#6366F1', '#A855F7'] }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          cutout: '65%',
          plugins: {
            legend: { position: 'right' },
            datalabels: { display: true, color: '#fff', font: { size: 16 } }
          },
        },
        plugins: [ChartDataLabels],
      });
    }
    return () => {
      if (donutChartRef.current?.chart) {
        donutChartRef.current.chart.destroy();
      }
    };
  }, [runs]);

  const handleAskSubmit = async () => {
    if (!isGeminiEnabled) return;
    setLoading(true);
    setGeminiError('');
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
        setGeminiError(data.message || 'Something went wrong');
      }
    } catch (err) {
      setGeminiError('Failed to connect to the server');
    } finally {
      setLoading(false);
    }
  };

  const handleTestSubmit = async (e) => {
    e.preventDefault();
    setSubmissionStatus('loading');
    setRunsError('');
    const formData = new FormData(e.target);
    const initiator = formData.get('initiator');
    const passphrase = formData.get('passphrase');
    const file = formData.get('file');
    const reader = new FileReader();
    reader.onload = async () => {
      const fileData = reader.result.split(',')[1];
      try {
        const response = await fetch('/api/trigger-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initiator, passphrase, file: fileData }),
        });
        const data = await response.json();
        if (response.ok) {
          setSubmissionStatus('Success');
          setTestStatus('Test initiated! Check GitHub Actions.');
        } else {
          setSubmissionStatus('Failed');
          setRunsError(data.message || 'Failed to initiate test');
          setTestStatus('');
        }
      } catch (err) {
        setSubmissionStatus('Failed');
        setRunsError('Failed to connect to the server');
        setTestStatus('');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleEnableGemini = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/validate-gemini-passphrase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase: geminiPassphrase }),
      });
      const data = await response.json();
      if (data.valid) {
        setIsGeminiEnabled(true);
        setGeminiError('');
      } else {
        setGeminiError(data.message || 'Invalid passphrase');
      }
    } catch (err) {
      setGeminiError('Failed to validate passphrase');
    }
  };

  const sortedRuns = [...runs].sort((a, b) => new Date(b.date) - new Date(a.date));
  const displayedRuns = showAll ? sortedRuns : sortedRuns.slice(0, 3);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 transition-colors duration-200">
      <main className="container mx-auto px-4 py-8 relative">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">QA Run Dashboard</h1>
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="p-2 rounded-lg bg-gray-600 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 transition-colors text-gray-900 dark:text-gray-100"
            aria-label="Toggle dark mode"
          >
            {isDarkMode ? (
              <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e8eaed">
                <path d="M480-360q50 0 85-35t35-85q0-50-35-85t-85-35q-50 0-85 35t-35 85q0 50 35 85t85 35Zm0 80q-83 0-141.5-58.5T280-480q0-83 58.5-141.5T480-680q83 0 141.5 58.5T680-480q0 83-58.5 141.5T480-280ZM200-440H40v-80h160v80Zm720 0H760v-80h160v80ZM440-760v-160h80v160h-80Zm0 720v-160h80v160h-80ZM256-650l-101-97 57-59 96 100-52 56Zm492 496-97-101 53-55 101 97-57 59Zm-98-550 97-101 59 57-100 96-56-52ZM154-212l101-97 55 53-97 101-59-57Zm326-268Z"/>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e8eaed">
                <path d="M480-120q-150 0-255-105T120-480q0-150 105-255t255-105q14 0 27.5 1t26.5 3q-41 29-65.5 75.5T444-660q0 90 63 153t153 63q55 0 101-24.5t75-65.5q2 13 3 26.5t1 27.5q0 150-105 255T480-120Zm0-80q88 0 158-48.5T740-375q-20 5-40 8t-40 3q-123 0-209.5-86.5T364-660q0-20 3-40t8-40q-78 32-126.5 102T200-480q0 116 82 198t198 82Zm-10-270Z"/>
              </svg>
            )}
          </button>
        </div>
        <div className="space-y-6">
          <div className="flex gap-6 mb-6">
            <div className="flex-[2] p-4 bg-white dark:bg-gray-800 rounded-xl shadow-md overflow-x-auto">
              <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100">Crawls Trended</h2>
              <div style={{ height: '300px', width: '100%' }}>
                <canvas ref={chartRef}></canvas>
              </div>
            </div>
            <div className="flex-1 p-4 bg-white dark:bg-gray-800 rounded-xl shadow-md flex flex-col justify-center items-center">
              <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100">Crawl Types</h2>
              <div style={{ height: '400px', width: '400px' }}>
                <canvas ref={donutChartRef}></canvas>
              </div>
            </div>
          </div>
          <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-md mb-6 max-h-96 overflow-y-auto relative">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Recent Crawl Information</h2>
              {runs.length > 3 && (
                <button
                  onClick={() => setShowAll(!showAll)}
                  className="text-blue-500 hover:underline sticky top-0 right-0"
                >
                  {showAll ? 'Collapse All' : 'Show All'}
                </button>
              )}
            </div>
            {loading ? (
              <p className="text-gray-500 dark:text-gray-400">Loading...</p>
            ) : runsError ? (
              <p className="text-red-500">{runsError}</p>
            ) : (
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-gray-200 dark:bg-gray-700">
                  <tr>
                    <th className="p-2">Crawl Name</th>
                    <th className="p-2">Date & Time</th>
                    <th className="p-2">Initiator</th>
                    <th className="p-2">Success</th>
                    <th className="p-2">Failed</th>
                    <th className="p-2">Output Artifacts</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedRuns.map((run, index) => (
                    <React.Fragment key={run.runId || `run-${index}`}>
                      <tr className={`border-b dark:border-gray-700 ${index % 2 === 0 ? 'bg-gray-50 dark:bg-gray-800' : 'bg-white dark:bg-gray-700'}`}>
                        <td className="p-2">
                          {run.hasArtifacts && (
                            <button
                              onClick={() => toggleRow(run.runId)}
                              className="mr-2 text-blue-500"
                            >
                              {expandedRows.includes(run.runId) ? '-' : '+'}
                            </button>
                          )}
                          {run.crawlName}
                        </td>
                        <td className="p-2">
                          {new Date(run.date).toLocaleString('en-US', { timeZone: 'America/Chicago' })}
                        </td>
                        <td className="p-2">{run.initiator}</td>
                        <td className="p-2">{run.successCount}</td>
                        <td className="p-2">{run.failureCount}</td>
                        <td className="p-2">
                          {run.hasArtifacts ? (
                            <a href={`https://github.com/rsmedstad/qa-automation-tool/actions/runs/${run.runId}`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                              <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e8eaed" className="inline mr-1">
                                <path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h560v-280h80v280q0 33-23.5 56.5T760-120H200Zm188-212-56-56 372-372H560v-80h280v280h-80v-144L388-332Z"/>
                              </svg>
                              View ({run.artifactCount})
                            </a>
                          ) : (
                            'None'
                          )}
                        </td>
                      </tr>
                      {expandedRows.includes(run.runId) && run.hasArtifacts && (
                        <tr key={`artifact-${run.runId}`} className="bg-gray-100 dark:bg-gray-600">
                          <td colSpan="6" className="p-2 pl-8">
                            Artifacts: results-{run.runId}.xlsx, screenshots-{run.runId}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-md">
              <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100">Request Ad-Hoc Crawl</h2>
              <form onSubmit={handleTestSubmit} className="space-y-4">
                <div className="mb-4">
                  <label className="block text-gray-900 dark:text-gray-100 mb-1" htmlFor="initiator">Your Name</label>
                  <input type="text" id="initiator" name="initiator" className="w-full p-2 rounded-lg bg-gray-100 dark:bg-gray-700" required />
                </div>
                <div className="mb-4">
                  <label className="block text-gray-900 dark:text-gray-100 mb-1" htmlFor="passphrase">Passphrase</label>
                  <input type="text" id="passphrase" name="passphrase" className="w-full p-2 rounded-lg bg-gray-100 dark:bg-gray-700" required />
                </div>
                <div className="mb-4">
                  <label className="block text-gray-900 dark:text-gray-100 mb-1" htmlFor="file">Select input.xlsx</label>
                  <input type="file" id="file" name="file" accept=".xlsx" className="w-full p-2 rounded-lg bg-gray-100 dark:bg-gray-700" required />
                </div>
                <div className="flex justify-end">
                  <button type="submit" className="p-2 bg-green-500 text-white rounded-lg">Run Test</button>
                </div>
              </form>
              {submissionStatus && (
                <p className={submissionStatus === 'Failed' ? 'text-red-500' : 'text-green-500'}>
                  {submissionStatus}
                </p>
              )}
            </div>
            <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-md">
              <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100">Ask Gemini</h2>
              {!isGeminiEnabled ? (
                <form onSubmit={handleEnableGemini} className="space-y-4">
                  <div className="mb-4">
                    <input
                      type="text"
                      value={geminiPassphrase}
                      onChange={(e) => setGeminiPassphrase(e.target.value)}
                      placeholder="Enter passphrase to enable Gemini"
                      className="w-full p-2 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                    />
                    {geminiError && <p className="text-red-500 mt-1">{geminiError}</p>}
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="px-4 py-2 bg-gray-600 dark:bg-gray-700 text-white rounded hover:bg-gray-700 dark:hover:bg-gray-600"
                    >
                      Enable Gemini
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="mb-4">
                    <input
                      type="text"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="Ask about test results or protocol"
                      className="w-full p-2 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 max-h-32 overflow-y-auto"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={handleAskSubmit}
                      disabled={loading}
                      className="px-4 py-2 bg-gray-600 dark:bg-gray-700 text-white rounded hover:bg-gray-700 dark:hover:bg-gray-600 disabled:opacity-50"
                    >
                      {loading ? 'Loading...' : 'Ask'}
                    </button>
                  </div>
                  {answer && (
                    <p className="mt-2 text-gray-900 dark:text-gray-100">
                      <strong>Answer:</strong> {answer}
                    </p>
                  )}
                  {geminiError && <p className="mt-2 text-red-500">{geminiError}</p>}
                </div>
              )}
            </div>
          </div>
          <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-md">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Test Definitions</h2>
              <button
                onClick={() => setIsTestDefsExpanded(!isTestDefsExpanded)}
                className="text-gray-500 dark:text-gray-400 hover:underline"
              >
                {isTestDefsExpanded ? 'Collapse' : 'Expand'}
              </button>
            </div>
            {isTestDefsExpanded && (
              <div className="prose dark:prose-invert max-h-120 overflow-y-auto text-gray-900 dark:text-gray-100">
                <ReactMarkdown remarkPlugins={[remarkEmoji, remarkGfm]}>{readme}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}