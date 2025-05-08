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
  const [isTestDefsExpanded, setIsTestDefsExpanded] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [isGeminiEnabled, setIsGeminiEnabled] = useState(false);
  const [geminiPassphrase, setGeminiPassphrase] = useState('');
  const chartRef = useRef(null);
  const donutChartRef = useRef(null);

  // Effect to fetch initial run data
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
          runId: run.runId || `fallback-${idx}`, // Ensure runId exists
          hasArtifacts: run.hasArtifacts ?? false,
          artifactCount: run.artifactCount || 0,
          artifactsList: run.artifactsList || [],
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

  // Effect to fetch README content
  useEffect(() => {
    fetch('https://api.github.com/repos/rsmedstad/qa-automation-tool/readme')
      .then((res) => res.json())
      .then((data) => {
        if (data.content) {
          const decoded = atob(data.content);
          const utf8Decoded = decodeURIComponent(Array.prototype.map.call(decoded, function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
          }).join(''));
          setReadme(utf8Decoded);
        } else {
          console.error('README content not found in API response:', data);
          setReadme('Failed to load README content.');
        }
      })
      .catch((err) => {
        console.error('Failed to fetch README', err);
        setReadme('Failed to fetch README: ' + err.message);
      });
  }, []);

  // Effect to set initial dark mode state from localStorage or system preference
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

  // Effect to apply dark mode class to HTML element and save preference
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (isDarkMode) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      localStorage.setItem('darkMode', String(isDarkMode));
    }
  }, [isDarkMode]);

  // Effect to render and update the "Crawls Trended" bar chart
  useEffect(() => {
    if (runs.length > 0 && chartRef.current) {
      const ctx = chartRef.current.getContext('2d');
      const sortedRuns = [...runs].sort((a, b) => new Date(a.date) - new Date(b.date));
      const recentRuns = sortedRuns.slice(-24); // Get the last 24 runs

      const labels = recentRuns.map(run => {
        const date = new Date(run.date);
        return `${date.toLocaleDateString()}\n${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      });
      const passedData = recentRuns.map(run => run.successCount || 0);
      const failedData = recentRuns.map(run => run.failureCount || 0);
      const naData = recentRuns.map(run => run.naCount || 0);

      const filteredIndices = recentRuns.map((run, index) =>
        (passedData[index] > 0 || failedData[index] > 0 || naData[index] > 0) ? index : null
      ).filter(index => index !== null);

      const filteredLabels = filteredIndices.map(index => labels[index]);
      const filteredPassedData = filteredIndices.map(index => passedData[index]);
      const filteredFailedData = filteredIndices.map(index => failedData[index]);
      const filteredNaData = filteredIndices.map(index => naData[index]);

      const maxTotalUrls = Math.max(0, ...filteredIndices.map(index =>
        (filteredPassedData[index] || 0) + (filteredFailedData[index] || 0) + (filteredNaData[index] || 0)
      ));
      const yAxisMax = maxTotalUrls > 0 ? Math.ceil(maxTotalUrls / 5) * 5 + 10 : 50;

      if (chartRef.current.chart) {
        chartRef.current.chart.destroy();
      }

      const tickColor = isDarkMode ? 'rgba(229, 231, 235, 0.7)' : 'rgba(75, 85, 99, 0.7)';
      const titleColor = isDarkMode ? '#E5E7EB' : '#374151';
      const legendColor = isDarkMode ? '#E5E7EB' : '#374151';
      const datalabelColor = isDarkMode ? '#FFFFFF' : '#000000';

      chartRef.current.chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: filteredLabels,
          datasets: [
            {
              label: '# Passed',
              data: filteredPassedData,
              backgroundColor: 'rgba(75, 192, 75, 0.6)',
              borderColor: 'rgba(75, 192, 75, 1)',
              borderWidth: 1
            },
            {
              label: '# Failed',
              data: filteredFailedData,
              backgroundColor: 'rgba(255, 99, 132, 0.6)',
              borderColor: 'rgba(255, 99, 132, 1)',
              borderWidth: 1
            },
            {
              label: '# N/A',
              data: filteredNaData,
              backgroundColor: 'rgba(255, 206, 86, 0.6)',
              borderColor: 'rgba(255, 206, 86, 1)',
              borderWidth: 1
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
                color: tickColor,
                callback: function(value, index) {
                  const label = filteredLabels[index];
                  return label ? label.split('\n') : '';
                },
              },
              grid: {
                color: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
              }
            },
            y: {
              stacked: true,
              beginAtZero: true,
              max: yAxisMax,
              ticks: {
                stepSize: (yAxisMax > 20 && yAxisMax <=100) ? 10 : (yAxisMax <= 20 ? 5 : 20),
                precision: 0,
                color: tickColor,
              },
              title: {
                display: true,
                text: 'Total URLs Crawled',
                padding: { top:0, bottom: 10 },
                color: titleColor,
                font: {
                    size: 14,
                    weight: 'bold'
                }
              },
              grid: {
                color: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
              }
            },
          },
          responsive: true,
          maintainAspectRatio: false,
          layout: {
            padding: {
              left: 10,
              right: 20,
              top: 20,
              bottom: 10,
            },
          },
          plugins: {
            legend: {
              display: true,
              position: 'top',
              labels: {
                color: legendColor,
                boxWidth: 20,
                padding: 20
              }
            },
            datalabels: {
              display: true,
              color: datalabelColor,
              anchor: 'center',
              align: 'center',
              font: {
                  weight: 'bold'
              },
              formatter: (value) => value > 0 ? value : '',
            },
            tooltip: {
                backgroundColor: isDarkMode ? 'rgba(40,40,40,0.9)' : 'rgba(245,245,245,0.9)',
                titleColor: isDarkMode ? '#E5E7EB' : '#374151',
                bodyColor: isDarkMode ? '#E5E7EB' : '#374151',
                borderColor: isDarkMode ? '#555' : '#ccc',
                borderWidth: 1
            }
          },
        },
        plugins: [ChartDataLabels],
      });
    }
    return () => {
      if (chartRef.current?.chart) {
        chartRef.current.chart.destroy();
        chartRef.current.chart = null;
      }
    };
  }, [runs, isDarkMode]);

  // Effect to render and update the "Crawl Types" donut chart
  useEffect(() => {
    if (runs.length > 0 && donutChartRef.current) {
      const ctx = donutChartRef.current.getContext('2d');
      const scheduledCount = runs.filter(run => run.event === 'schedule').length;
      const adHocCount = runs.filter(run => run.event === 'workflow_dispatch').length;

      if (donutChartRef.current.chart) {
        donutChartRef.current.chart.destroy();
      }

      const legendColor = isDarkMode ? '#E5E7EB' : '#374151';
      const datalabelColor = '#FFFFFF';

      donutChartRef.current.chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Scheduled', 'Ad-Hoc'],
          datasets: [{
            data: [scheduledCount, adHocCount],
            backgroundColor: ['#6366F1', '#A855F7'],
            borderColor: [isDarkMode ? '#4338CA' : '#FFFFFF', isDarkMode ? '#7E22CE' : '#FFFFFF'],
            borderWidth: 2,
            hoverOffset: 4
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          cutout: '65%',
          plugins: {
            legend: {
              position: 'right',
              labels: {
                color: legendColor,
                boxWidth: 15,
                padding: 15
              }
            },
            datalabels: {
              display: true,
              color: datalabelColor,
              font: { size: 16, weight: 'bold' },
              formatter: (value) => {
                return value > 0 ? value : '';
              },
            },
            tooltip: {
                backgroundColor: isDarkMode ? 'rgba(40,40,40,0.9)' : 'rgba(245,245,245,0.9)',
                titleColor: isDarkMode ? '#E5E7EB' : '#374151',
                bodyColor: isDarkMode ? '#E5E7EB' : '#374151',
                borderColor: isDarkMode ? '#555' : '#ccc',
                borderWidth: 1,
                callbacks: {
                    label: function(context) {
                        let label = context.label || '';
                        if (label) {
                            label += ': ';
                        }
                        if (context.parsed !== null) {
                            label += context.parsed;
                        }
                        return label;
                    }
                }
            }
          },
        },
        plugins: [ChartDataLabels],
      });
    }
    return () => {
      if (donutChartRef.current?.chart) {
        donutChartRef.current.chart.destroy();
        donutChartRef.current.chart = null;
      }
    };
  }, [runs, isDarkMode]);

  // Handler for submitting a question to Gemini
  const handleAskSubmit = async () => {
    if (!isGeminiEnabled || !question.trim()) return;
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
        setGeminiError(data.message || 'Something went wrong with the LLM request.');
      }
    } catch (err) {
      console.error('Error asking LLM:', err);
      setGeminiError('Failed to connect to the server for LLM request.');
    } finally {
      setLoading(false);
    }
  };

  // Handler for submitting a test run
  const handleTestSubmit = async (e) => {
    e.preventDefault();
    setSubmissionStatus('loading');
    setRunsError('');
    setTestStatus('');

    const formData = new FormData(e.target);
    const initiator = formData.get('initiator');
    const passphrase = formData.get('passphrase');
    const file = formData.get('file');

    if (!file || !initiator || !passphrase) {
        setRunsError('Please fill in all fields and select a file.');
        setSubmissionStatus('Failed');
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        setRunsError('File is too large. Maximum 5MB allowed.');
        setSubmissionStatus('Failed');
        return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const fileData = reader.result.split(',')[1];
      try {
        const response = await fetch('/api/trigger-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initiator, passphrase, file: fileData, fileName: file.name }),
        });
        const data = await response.json();
        if (response.ok) {
          setSubmissionStatus('Success');
          setTestStatus('Test initiated! Check GitHub Actions for progress.');
          e.target.reset();
        } else {
          setSubmissionStatus('Failed');
          setRunsError(data.message || 'Failed to initiate test. Please check inputs.');
        }
      } catch (err) {
        console.error('Error triggering test:', err);
        setSubmissionStatus('Failed');
        setRunsError('Failed to connect to the server to trigger the test.');
      }
    };
    reader.onerror = () => {
        console.error('Error reading file');
        setRunsError('Could not read the selected file.');
        setSubmissionStatus('Failed');
    };
    reader.readAsDataURL(file);
  };

  // Handler for enabling Gemini with a passphrase
  const handleEnableGemini = async (e) => {
    e.preventDefault();
    if (!geminiPassphrase.trim()) {
        setGeminiError('Passphrase cannot be empty.');
        return;
    }
    setLoading(true);
    setGeminiError('');
    try {
      const response = await fetch('/api/validate-gemini-passphrase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase: geminiPassphrase }),
      });
      const data = await response.json();
      if (data.valid) {
        setIsGeminiEnabled(true);
        setGeminiPassphrase('');
      } else {
        setGeminiError(data.message || 'Invalid passphrase. Please try again.');
      }
    } catch (err) {
      console.error('Error validating Gemini passphrase:', err);
      setGeminiError('Failed to validate passphrase due to a server error.');
    } finally {
        setLoading(false);
    }
  };

  // Sort runs by date (newest first) for display
  const sortedRuns = [...runs].sort((a, b) => new Date(b.date) - new Date(a.date));
  const displayedRuns = showAll ? sortedRuns : sortedRuns.slice(0, 5);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 transition-colors duration-200 font-sans">
      <main className="container mx-auto px-2 sm:px-4 py-6 sm:py-8">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row justify-between items-center mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-gray-200 mb-2 sm:mb-0">QA Run Dashboard</h1>
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="p-2 rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Toggle dark mode"
          >
            {isDarkMode ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>
        </div>

        {/* Main Content Area - Grid for Charts */}
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* Crawls Trended Chart */}
            <div className="lg:col-span-2 p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
              <h2 className="text-xl font-semibold mb-3 text-gray-700 dark:text-gray-300">Crawls Trended</h2>
              <div style={{ height: '400px', width: '100%' }}>
                <canvas ref={chartRef}></canvas>
              </div>
            </div>
            {/* Crawl Types Chart */}
            <div className="lg:col-span-1 p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg flex flex-col justify-center items-center">
              <h2 className="text-xl font-semibold mb-3 text-gray-700 dark:text-gray-300">Crawl Types</h2>
              <div style={{ height: '380px', width: '100%', maxWidth: '380px' }}>
                <canvas ref={donutChartRef}></canvas>
              </div>
            </div>
          </div>

          {/* Recent Crawl Information Table */}
          <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg mb-6">
            <div className="sticky top-0 bg-white dark:bg-gray-800 z-20 py-2 border-b border-gray-200 dark:border-gray-700">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300">Recent Crawl Information</h2>
                {runs.length > 5 && (
                  <button
                    onClick={() => setShowAll(!showAll)}
                    className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium transition-colors text-sm"
                  >
                    {showAll ? 'Collapse All' : `Show All (${runs.length})`}
                  </button>
                )}
              </div>
            </div>
            <div className="max-h-[26rem] overflow-y-auto">
              {loading && !runs.length ? (
                <p className="text-gray-500 dark:text-gray-400 text-center py-4">Loading run data...</p>
              ) : runsError ? (
                <p className="text-red-500 dark:text-red-400 text-center py-4">{runsError}</p>
              ) : displayedRuns.length === 0 && !loading ? (
                <p className="text-gray-500 dark:text-gray-400 text-center py-4">No crawl data available.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-gray-100 dark:bg-gray-700 z-10">
                      <tr>
                        <th className="p-3 font-semibold text-gray-600 dark:text-gray-300">Crawl Name</th>
                        <th className="p-3 font-semibold text-gray-600 dark:text-gray-300">Date & Time</th>
                        <th className="p-3 font-semibold text-gray-600 dark:text-gray-300">Initiator</th>
                        <th className="p-3 font-semibold text-gray-600 dark:text-gray-300 text-center">Passed</th>
                        <th className="p-3 font-semibold text-gray-600 dark:text-gray-300 text-center">Failed</th>
                        <th className="p-3 font-semibold text-gray-600 dark:text-gray-300">Output Artifacts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedRuns.map((run, index) => (
                        <tr key={run.runId || `run-${index}`} className={`border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${index % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-800/60'}`}>
                          <td className="p-3 whitespace-nowrap">{run.crawlName || 'N/A'}</td>
                          <td className="p-3 whitespace-nowrap">{new Date(run.date).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Chicago' })}</td>
                          <td className="p-3 whitespace-nowrap">{run.initiator || 'N/A'}</td>
                          <td className="p-3 text-green-600 dark:text-green-400 font-medium text-center">{run.successCount || 0}</td>
                          <td className="p-3 text-red-600 dark:text-red-400 font-medium text-center">{run.failureCount || 0}</td>
                          <td className="p-3">
                            {run.hasArtifacts ? (
                              <a href={`https://github.com/rsmedstad/qa-automation-tool/actions/runs/${run.runId}`} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                                View ({run.artifactCount || 0})
                              </a>
                            ) : (
                              <span className="text-gray-500 dark:text-gray-400">None</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Ad-Hoc Crawl and Ask Gemini Section - Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Request Ad-Hoc Crawl Form */}
            <div className="p-4 sm:p-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg">
              <h2 className="text-xl font-semibold mb-4 text-gray-700 dark:text-gray-300">Request Ad-Hoc Crawl</h2>
              <form onSubmit={handleTestSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" htmlFor="initiator">Your Name</label>
                  <input type="text" id="initiator" name="initiator" className="w-full p-2.5 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 focus:ring-indigo-500 focus:border-indigo-500 dark:focus:ring-indigo-500 dark:focus:border-indigo-500 text-sm" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" htmlFor="passphrase">Passphrase</label>
                  <input type="text" id="passphrase" name="passphrase" className="w-full p-2.5 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 focus:ring-indigo-500 focus:border-indigo-500 dark:focus:ring-indigo-500 dark:focus:border-indigo-500 text-sm" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" htmlFor="file">Select input.xlsx</label>
                  <input type="file" id="file" name="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 dark:file:bg-indigo-800 file:text-indigo-700 dark:file:text-indigo-300 hover:file:bg-indigo-100 dark:hover:file:bg-indigo-700 cursor-pointer" required />
                </div>
                <div className="flex justify-end pt-2">
                  <button type="submit" disabled={submissionStatus === 'loading'} className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:opacity-60">
                    {submissionStatus === 'loading' ? 'Submitting...' : 'Run Test'}
                  </button>
                </div>
              </form>
              {submissionStatus && submissionStatus !== 'loading' && (
                <p className={`mt-3 text-sm ${submissionStatus === 'Failed' ? 'text-red-500 dark:text-red-400' : 'text-green-500 dark:text-green-400'}`}>
                  {submissionStatus === 'Success' ? testStatus : runsError}
                </p>
              )}
            </div>

            {/* Ask Gemini Section */}
            <div className="p-4 sm:p-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg">
              <h2 className="text-xl font-semibold mb-4 text-gray-700 dark:text-gray-300">Ask Gemini</h2>
              {!isGeminiEnabled ? (
                <form onSubmit={handleEnableGemini} className="space-y-4">
                  <div>
                    <input
                      type="text"
                      value={geminiPassphrase}
                      onChange={(e) => setGeminiPassphrase(e.target.value)}
                      placeholder="Enter passphrase to enable Gemini"
                      className="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 focus:ring-indigo-500 focus:border-indigo-500 dark:focus:ring-indigo-500 dark:focus:border-indigo-500 text-sm"
                    />
                    {geminiError && !loading && <p className="text-red-500 dark:text-red-400 mt-1 text-xs">{geminiError}</p>}
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-5 py-2.5 bg-gray-600 dark:bg-gray-500 hover:bg-gray-700 dark:hover:bg-gray-600 text-white rounded-lg font-medium text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:opacity-60"
                    >
                      {loading ? 'Enabling...' : 'Enable Gemini'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <div>
                    <textarea
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="Ask about test results or QA protocol..."
                      rows="3"
                      className="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 focus:ring-indigo-500 focus:border-indigo-500 dark:focus:ring-indigo-500 dark:focus:border-indigo-500 text-sm resize-none"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={handleAskSubmit}
                      disabled={loading || !question.trim()}
                      className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:opacity-60"
                    >
                      {loading && answer === '' ? 'Thinking...' : 'Ask'}
                    </button>
                  </div>
                  {geminiError && <p className="mt-2 text-sm text-red-500 dark:text-red-400">{geminiError}</p>}
                  {answer && (
                    <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                      <p className="text-sm text-gray-800 dark:text-gray-200">
                        <strong>Answer:</strong>
                        <ReactMarkdown remarkPlugins={[remarkEmoji, remarkGfm]} className="prose prose-sm dark:prose-invert max-w-none mt-1">
                            {answer}
                        </ReactMarkdown>
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Test Definitions (README) Section */}
          <div className="p-4 sm:p-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300">Test Definitions & Protocol</h2>
              <button
                onClick={() => setIsTestDefsExpanded(!isTestDefsExpanded)}
                className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium transition-colors text-sm"
              >
                {isTestDefsExpanded ? 'Collapse' : 'Expand'}
              </button>
            </div>
            {isTestDefsExpanded && (
              <div className="prose prose-sm dark:prose-invert max-w-none max-h-96 overflow-y-auto p-1 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 custom-scrollbar">
                {readme ? <ReactMarkdown remarkPlugins={[remarkEmoji, remarkGfm]}>{readme}</ReactMarkdown> : <p>Loading README...</p>}
              </div>
            )}
          </div>
        </div>
      </main>
      <footer className="text-center py-6 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 mt-10">
         {/* */}
      </footer>
    </div>
  );
}