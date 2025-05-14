import React, { useEffect, useState, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { Bar } from 'react-chartjs-2';
import Head from 'next/head';

export default function Dashboard() {
  const [runs, setRuns] = useState([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [messages, setMessages] = useState([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [askLoading, setAskLoading] = useState(false);
  const [runsError, setRunsError] = useState('');
  const [geminiError, setGeminiError] = useState('');
  const [testStatus, setTestStatus] = useState('');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [isGeminiEnabled, setIsGeminiEnabled] = useState(false);
  const [geminiPassphrase, setGeminiPassphrase] = useState('');
  const [storedPassphrase, setStoredPassphrase] = useState('');
  const [testType, setTestType] = useState('standard');
  const [testDefinitions, setTestDefinitions] = useState([]);
  const [sfTests, setSfTests] = useState([]);
  const [activeTab, setActiveTab] = useState('testDefinitions');
  const chartRef = useRef(null);
  const donutChartRef = useRef(null);

  useEffect(() => {
    const fetchRuns = async () => {
      setRunsLoading(true);
      try {
        const res = await fetch(`/api/get-runs?cache_bust=${Date.now()}`, {
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const data = await res.json();
        console.log('Fetched runs:', data);
        const sanitizedData = data.map((run, idx) => ({
          ...run,
          runId: run.runId || `fallback-${idx}`,
          hasArtifacts: run.hasArtifacts ?? false,
          artifactCount: run.artifactCount || 0,
          artifactsList: run.artifactsList || [],
          failed_urls: run.failed_urls || [],
          failed_tests: run.failed_tests || {},
        }));
        setRuns(sanitizedData);
      } catch (err) {
        console.error('Error fetching runs:', err);
        setRunsError('Failed to load runs: ' + err.message);
      } finally {
        setRunsLoading(false);
      }
    };
    fetchRuns();
  }, []);

  useEffect(() => {
    const fetchTestDefs = async () => {
      try {
        const res = await fetch(`/api/get-test-definitions?cache_bust=${Date.now()}`, {
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const { testDefinitions = [], sfTests = [] } = await res.json();
        setTestDefinitions(testDefinitions);
        setSfTests(sfTests);
      } catch (err) {
        console.error('Error fetching test definitions:', err);
      }
    };
    fetchTestDefs();
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
      document.documentElement.classList.toggle('dark', isDarkMode);
      localStorage.setItem('darkMode', String(isDarkMode));
    }
  }, [isDarkMode]);

  useEffect(() => {
    if (runs.length > 0 && chartRef.current) {
      try {
        const ctx = chartRef.current.getContext('2d');
        const sortedRunsChartData = [...runs].sort((a, b) => new Date(a.date) - new Date(b.date));
        const recentRuns = sortedRunsChartData.slice(-24);

        const labels = recentRuns.map((run) => {
          const date = new Date(run.date);
          return `${date.toLocaleDateString()}\n${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        });
        const passedData = recentRuns.map((run) => run.successCount || 0);
        const failedData = recentRuns.map((run) => run.failureCount || 0);
        const naData = recentRuns.map((run) => run.naCount || 0);

        const filteredIndices = recentRuns
          .map((run, index) => (passedData[index] > 0 || failedData[index] > 0 || naData[index] > 0 ? index : null))
          .filter((index) => index !== null);

        const filteredLabels = filteredIndices.map((index) => labels[index]);
        const filteredPassedData = filteredIndices.map((index) => passedData[index]);
        const filteredFailedData = filteredIndices.map((index) => failedData[index]);
        const filteredNaData = filteredIndices.map((index) => naData[index]);

        const maxTotalUrls = Math.max(
          0,
          ...filteredIndices.map((index) => (filteredPassedData[index] || 0) + (filteredFailedData[index] || 0) + (filteredNaData[index] || 0))
        );
        const yAxisMax = maxTotalUrls > 0 ? Math.ceil(maxTotalUrls / 5) * 5 + 10 : 50;

        if (chartRef.current.chart) chartRef.current.chart.destroy();

        const tickColor = isDarkMode ? 'rgba(229, 231, 235, 0.7)' : 'rgba(75, 85, 99, 0.7)';
        const titleColor = isDarkMode ? '#E5E7EB' : '#374151';
        const legendColor = isDarkMode ? '#E5E7EB' : '#374151';
        const datalabelColor = isDarkMode ? '#FFFFFF' : '#000000';

        chartRef.current.chart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: filteredLabels,
            datasets: [
              { label: '# Passed', data: filteredPassedData, backgroundColor: 'rgba(75, 192, 75, 0.6)', borderColor: 'rgba(75, 192, 75, 1)', borderWidth: 1 },
              { label: '# Failed', data: filteredFailedData, backgroundColor: 'rgba(255, 99, 132, 0.6)', borderColor: 'rgba(255, 99, 132, 1)', borderWidth: 1 },
              { label: '# N/A', data: filteredNaData, backgroundColor: 'rgba(255, 206, 86, 0.6)', borderColor: 'rgba(255, 206, 86, 1)', borderWidth: 1 },
            ],
          },
          options: {
            scales: {
              x: {
                stacked: true,
                ticks: { autoSkip: true, maxTicksLimit: 10, maxRotation: 45, minRotation: 45, color: tickColor, callback: (value, index) => filteredLabels[index]?.split('\n') || '' },
                grid: { color: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)' },
              },
              y: {
                stacked: true,
                beginAtZero: true,
                max: yAxisMax,
                ticks: { stepSize: yAxisMax > 20 && yAxisMax <= 100 ? 10 : yAxisMax <= 20 ? 5 : 20, precision: 0, color: tickColor },
                title: { display: true, text: 'Total URLs Crawled', padding: { top: 0, bottom: 10 }, color: titleColor, font: { size: 14, weight: 'bold' } },
                grid: { color: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)' },
              },
            },
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { left: 10, right: 20, top: 20, bottom: 10 } },
            plugins: {
              legend: { display: true, position: 'top', labels: { color: legendColor, boxWidth: 20, padding: 20 } },
              datalabels: { display: true, color: datalabelColor, anchor: 'center', align: 'center', font: { weight: 'bold' }, formatter: (value) => (value > 0 ? value : '') },
              tooltip: {
                backgroundColor: isDarkMode ? 'rgba(40,40,40,0.9)' : 'rgba(245,245,245,0.9)',
                titleColor: isDarkMode ? '#E5E7EB' : '#374151',
                bodyColor: isDarkMode ? '#E5E7EB' : '#374151',
                borderColor: isDarkMode ? '#555' : '#ccc',
                borderWidth: 1,
              },
            },
          },
          plugins: [ChartDataLabels],
        });
      } catch (error) {
        console.error('Error rendering bar chart:', error);
      }
    }
    return () => {
      if (chartRef.current?.chart) {
        chartRef.current.chart.destroy();
        chartRef.current.chart = null;
      }
    };
  }, [runs, isDarkMode]);

  useEffect(() => {
    if (runs.length > 0 && donutChartRef.current) {
      try {
        const ctx = donutChartRef.current.getContext('2d');
        const scheduledCount = runs.filter((run) => run.event === 'schedule').length;
        const adHocCount = runs.filter((run) => run.event === 'workflow_dispatch').length;

        if (donutChartRef.current.chart) donutChartRef.current.chart.destroy();

        const legendColor = isDarkMode ? '#E5E7EB' : '#374151';
        const datalabelColor = '#FFFFFF';

        donutChartRef.current.chart = new Chart(ctx, {
          type: 'doughnut',
          data: {
            labels: ['Scheduled', 'Ad-Hoc'],
            datasets: [{ data: [scheduledCount, adHocCount], backgroundColor: ['#6366F1', '#A855F7'], borderColor: [isDarkMode ? '#4338CA' : '#FFFFFF', isDarkMode ? '#7E22CE' : '#FFFFFF'], borderWidth: 2, hoverOffset: 4 }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            cutout: '65%',
            plugins: {
              legend: { position: 'right', labels: { color: legendColor, boxWidth: 15, padding: 15 } },
              datalabels: { display: true, color: datalabelColor, font: { size: 16, weight: 'bold' }, formatter: (value) => (value > 0 ? value : '') },
              tooltip: {
                backgroundColor: isDarkMode ? 'rgba(40,40,40,0.9)' : 'rgba(245,245,245,0.9)',
                titleColor: isDarkMode ? '#E5E7EB' : '#374151',
                bodyColor: isDarkMode ? '#E5E7EB' : '#374151',
                borderColor: isDarkMode ? '#555' : '#ccc',
                borderWidth: 1,
                callbacks: { label: (context) => `${context.label || ''}: ${context.parsed || ''}` },
              },
            },
          },
          plugins: [ChartDataLabels],
        });
      } catch (error) {
        console.error('Error rendering donut chart:', error);
      }
    }
    return () => {
      if (donutChartRef.current?.chart) {
        donutChartRef.current.chart.destroy();
        donutChartRef.current.chart = null;
      }
    };
  }, [runs, isDarkMode]);

  const FailingTestsChart = ({ failedTests }) => {
    const hasFails = failedTests && Object.keys(failedTests).length > 0;

    const data = hasFails ? {
      labels: Object.keys(failedTests),
      datasets: [
        {
          label: 'Number of Fails',
          data: Object.values(failedTests),
          backgroundColor: 'rgba(255, 99, 132, 0.6)',
          borderColor: 'rgba(255, 99, 132, 1)',
          borderWidth: 1,
        },
      ],
    } : null;

    const options = {
      indexAxis: 'y',
      scales: {
        x: {
          beginAtZero: true,
          ticks: { stepSize: 1, color: isDarkMode ? 'rgba(229, 231, 235, 0.7)' : 'rgba(75, 85, 99, 0.7)' },
          grid: { color: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)' },
          title: { display: true, text: 'Number of Fails', color: isDarkMode ? '#E5E7EB' : '#374151', font: { size: 14, weight: 'bold' } },
        },
        y: {
          ticks: { color: isDarkMode ? 'rgba(229, 231, 235, 0.7)' : 'rgba(75, 85, 99, 0.7)' },
          grid: { color: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)' },
        },
      },
      plugins: {
        legend: { display: false },
        datalabels: { display: true, color: isDarkMode ? '#FFFFFF' : '#000000', anchor: 'end', align: 'right', font: { weight: 'bold' }, formatter: (value) => (value > 0 ? value : '') },
        tooltip: {
          backgroundColor: isDarkMode ? 'rgba(40,40,40,0.9)' : 'rgba(245,245,245,0.9)',
          titleColor: isDarkMode ? '#E5E7EB' : '#374151',
          bodyColor: isDarkMode ? '#E5E7EB' : '#374151',
          borderColor: isDarkMode ? '#555' : '#ccc',
          borderWidth: 1,
        },
      },
      responsive: true,
      maintainAspectRatio: false,
    };

    return (
      <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg">
        <div className="py-2 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300">Latest Crawl Issues</h2>
        </div>
        {hasFails ? (
          <div style={{ height: '300px' }}>
            <Bar data={data} options={options} />
          </div>
        ) : (
          <p className="text-gray-500 dark:text-gray-400 text-center py-4">No fails observed in the most recent crawl.</p>
        )}
      </div>
    );
  };

  const handleAskSubmit = async () => {
    if (!isGeminiEnabled || !question.trim()) return;
    const userQuestion = question;
    setMessages((prev) => [...prev, { type: 'user', content: userQuestion }]);
    setQuestion('');
    setAskLoading(true);
    setGeminiError('');

    const recentRuns = sortedRuns.slice(0, 3);
    const passedRuns = recentRuns.filter((run) => run.failureCount === 0).length;
    const failedRuns = recentRuns.filter((run) => run.failureCount > 0).length;

    const runDetails = recentRuns.map((run) => {
      const date = new Date(run.date).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Chicago',
      });
      const failedUrls = run.failed_urls.length > 0 ? `\n  - Failed URLs: ${run.failed_urls.map(u => u.url).join(', ')}` : '';
      const failedTests = Object.keys(run.failed_tests).length > 0 ? `\n  - Failed Tests: ${Object.entries(run.failed_tests).map(([tc, count]) => `${tc} (${count})`).join(', ')}` : '';
      return `- Run on ${date} by ${run.initiator || 'N/A'}: ${run.successCount || 0} passed, ${run.failureCount || 0} failed, ${run.naCount || 0} N/A. Run ID: ${run.runId}. Artifacts: ${
        run.hasArtifacts ? `Available (link: https://github.com/rsmedstad/qa-automation-tool/actions/runs/${run.runId})` : 'None'
      }.${failedUrls}${failedTests}`;
    }).join('\n');

    const runSummary = `Recent QA crawls overview: Out of the last ${recentRuns.length} runs, ${passedRuns} had no failures, and ${failedRuns} had at least one failure.\nDetailed Runs:\n${runDetails}`;

    const systemMessage = `You are an AI assistant for the QA Automation Tool by rsmedstad. You should try to answer succinctly and utilize list format or style-enhancing elements when appropriate. For any questions about 'runs', 'crawls', 'QAs', or the tool's performance, always review and consider the following:
- ${runSummary}
- Resources for additional context:
  - Vercel Dashboard: https://qa-automation-tool.vercel.app/
  - GitHub Repo: https://github.com/rsmedstad/qa-automation-tool
  - GitHub Actions (QA Crawl): https://github.com/rsmedstad/qa-automation-tool/actions
  - Tests & Definitions (README.md): https://github.com/rsmedstad/qa-automation-tool/blob/main/README.md
  - Technical specifications for how each test (TC) is conducted to answer more detailed or technical questions from users: https://github.com/rsmedstad/qa-automation-tool/blob/main/api/qa-test.js
When answering questions about recent crawls, analyze the detailed run data provided above. Highlight specifics such as which runs failed, the number of failures, any patterns (e.g., consistent failures by a specific initiator), and specific details like failed URLs or tests if available. If the data lacks specific failure details, note that more information can be found in the artifacts. Provide a concise, relevant answer using lists or structured formatting when appropriate. Do not encourage users to leave the site; instead, use the information to directly answer their questions.`;

    const fullQuestion = `${systemMessage}\n\nUser Question: ${userQuestion}`;

    try {
      const response = await fetch('/api/ask-llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: fullQuestion, passphrase: storedPassphrase }),
      });
      const data = await response.json();
      if (response.ok) {
        setAnswer(data.answer);
        setMessages((prev) => [...prev, { type: 'gemini', content: data.answer }]);
      } else {
        setGeminiError(data.message || 'Something went wrong with the LLM request.');
      }
    } catch (err) {
      console.error('Error asking LLM:', err);
      setGeminiError('Failed to connect to the server for LLM request.');
    } finally {
      setAskLoading(false);
    }
  };

  const handleTestSubmit = async (e) => {
    e.preventDefault();
    setSubmissionStatus('loading');
    setRunsError('');
    setTestStatus('');

    const formData = new FormData(e.target);
    const initiator = formData.get('initiator');
    const passphrase = formData.get('passphrase');
    const file = formData.get('file');
    const captureVideoChecked = formData.get('captureVideo') === 'on';

    if ((testType === 'custom' && !file) || !initiator || !passphrase) {
      setRunsError('Please fill in all fields' + (testType === 'custom' ? ' and select a file.' : '.'));
      setSubmissionStatus('Failed');
      return;
    }
    if (file && file.size > 5 * 1024 * 1024) {
      setRunsError('File is too large. Maximum 5MB allowed.');
      setSubmissionStatus('Failed');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const fileData = file ? reader.result.split(',')[1] : null;
      try {
        const response = await fetch('/api/trigger-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            initiator,
            passphrase,
            ...(testType === 'custom' && file && { file: fileData, fileName: file.name }),
            captureVideo: captureVideoChecked
          }),
        });
        const data = await response.json();
        if (response.ok) {
          setSubmissionStatus('Success');
          setTestStatus('Test initiated! Check GitHub Actions for progress.');
          e.target.reset();
          setTestType('standard');
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
    if (file) {
      reader.readAsDataURL(file);
    } else {
      try {
        const response = await fetch('/api/trigger-test', {
          method: 'POST',
          headers: { 'Cache-Control': 'no-cache', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            initiator,
            passphrase,
            captureVideo: captureVideoChecked
          }),
        });
        const data = await response.json();
        if (response.ok) {
          setSubmissionStatus('Success');
          setTestStatus('Test initiated! Check GitHub Actions for progress.');
          e.target.reset();
          setTestType('standard');
        } else {
          setSubmissionStatus('Failed');
          setRunsError(data.message || 'Failed to initiate test. Please check inputs.');
        }
      } catch (err) {
        console.error('Error triggering test:', err);
        setSubmissionStatus('Failed');
        setRunsError('Failed to connect to the server to trigger the test.');
      }
    }
  };

  const handleEnableGemini = async (e) => {
    e.preventDefault();
    if (!geminiPassphrase.trim()) {
      setGeminiError('Passphrase cannot be empty.');
      return;
    }
    setAskLoading(true);
    setGeminiError('');
    try {
      const response = await fetch('/api/validate-gemini-passphrase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase: geminiPassphrase }),
      });
      const data = await response.json();
      if (data.valid) {
        setStoredPassphrase(geminiPassphrase);
        setIsGeminiEnabled(true);
        setGeminiPassphrase('');
      } else {
        setGeminiError(data.message || 'Invalid passphrase. Please try again.');
      }
    } catch (err) {
      console.error('Error validating Gemini passphrase:', err);
      setGeminiError('Failed to validate passphrase due to a server error.');
    } finally {
      setAskLoading(false);
    }
  };

  const sortedRuns = useMemo(() => {
    return [...runs].sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [runs]);

  const displayedRuns = showAll ? sortedRuns : sortedRuns.slice(0, 5);

  const getInsightMessage = (run) => {
    if (!run) return 'No crawls have been run yet.';
    const date = new Date(run.date).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Chicago',
    });
    const initiator = run.initiator || 'N/A';
    const failureCount = run.failureCount || 0;
    const failedUrls = run.failed_urls || [];
    const failedTests = run.failed_tests || {};
    let message = `Last crawl on ${date} by ${initiator}: `;
    if (failureCount > 0) {
      message += `${failureCount} failure${failureCount === 1 ? '' : 's'}.\n`;
      if (failedUrls.length > 0) {
        message += `- Failed URLs: ${failedUrls.map(u => u.url).join(', ')}\n`;
      }
      if (Object.keys(failedTests).length > 0) {
        message += `- Failed Tests: ${Object.entries(failedTests).map(([tc, count]) => `${tc} (${count})`).join(', ')}\n`;
      }
      message += 'Note: For precise URL-to-test failure mappings, check the artifacts.';
    } else {
      message += 'No failures.';
    }
    return message;
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAskSubmit();
    }
  };

  return (
    <>
      <Head>
        <title>QA Automation Dashboard</title>
        <meta name="description" content="QA Automation Testing Dashboard" />
        <meta name="robots" content="noindex" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" sizes="192x192" href="/favicon-192x192.png" />
        <link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192x192.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="/favicon-512x512.png" />
        <link rel="shortcut icon" href="/favicon.ico" />
        <link rel="mask-icon" href="/safari-pinned-tab.svg" color="#A855F7" />
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="msapplication-TileColor" content="#A855F7" />
        <meta name="theme-color" content="#A855F7" />
      </Head>
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 transition-colors duration-200 font-sans">
        <main className="container mx-auto px-2 sm:px-4 py-6 sm:py-8">
          <div className="flex flex-col sm:flex-row justify-between items-center mb-6 sm:mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-gray-200 mb-2 sm:mb-0">QA Automation Dashboard</h1>
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

          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
              <div className="lg:col-span-2 p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
                <h2 className="text-xl font-semibold mb-3 text-gray-700 dark:text-gray-300">Crawls Trended</h2>
                <div style={{ height: '400px', width: '100%' }}>
                  <canvas ref={chartRef}></canvas>
                </div>
              </div>
              <div className="lg:col-span-1 p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg flex flex-col justify-center items-center">
                <h2 className="text-xl font-semibold mb-3 text-gray-700 dark:text-gray-300">Crawl Types</h2>
                <div style={{ height: '380px', width: '100%', maxWidth: '380px' }}>
                  <canvas ref={donutChartRef}></canvas>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-6 items-start">
              <div className="lg:col-span-1">
                <FailingTestsChart failedTests={sortedRuns[0]?.failed_tests} />
              </div>
              <div className="lg:col-span-3 p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg">
                <div className="sticky top-0 bg-white dark:bg-gray-800 z-20 py-2 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex justify-between items-center">
                    <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300">Recent Crawl Information</h2>
                    {runs.length > 5 && (
                      <button
                        onClick={() => setShowAll(!showAll)}
                        className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium transition-colors text-sm"
                      >
                        {showAll ? `Collapse (${runs.length})` : `Expand (${runs.length})`}
                      </button>
                    )}
                  </div>
                </div>
                <div className="max-h-[26rem] overflow-y-auto">
                  {runsLoading && !runs.length ? (
                    <p className="text-gray-500 dark:text-gray-400 text-center py-4">Loading run data...</p>
                  ) : runsError ? (
                    <p className="text-red-500 dark:text-red-400 text-center py-4">{runsError}</p>
                  ) : displayedRuns.length === 0 && !runsLoading ? (
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
                            <tr
                              key={run.runId || `run-${index}`}
                              className={`border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                                index % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-800/60'
                              }`}
                            >
                              <td className="p-3 whitespace-nowrap">{run.crawlName || 'N/A'}</td>
                              <td className="p-3 whitespace-nowrap">
                                {new Date(run.date).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Chicago' })}
                              </td>
                              <td className="p-3 whitespace-nowrap">{run.initiator || 'N/A'}</td>
                              <td className="p-3 text-green-600 dark:text-green-400 font-medium text-center">{run.successCount || 0}</td>
                              <td className="p-3 text-red-600 dark:text-red-400 font-medium text-center">{run.failureCount || 0}</td>
                              <td className="p-3">
                                {run.hasArtifacts ? (
                                  <a
                                    href={`https://github.com/rsmedstad/qa-automation-tool/actions/runs/${run.runId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center"
                                  >
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
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-4 sm:p-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg">
                <h2 className="text-xl font-semibold mb-4 text-gray-700 dark:text-gray-300">Request Ad-Hoc Crawl</h2>
                <form onSubmit={handleTestSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" htmlFor="initiator">
                      Your Name
                    </label>
                    <input
                      type="text"
                      id="initiator"
                      name="initiator"
                      className="w-full p-2.5 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 focus:ring-indigo-500 focus:border-indigo-500 dark:focus:ring-indigo-500 dark:focus:border-indigo-500 text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" htmlFor="passphrase">
                      Passphrase
                    </label>
                    <input
                      type="text"
                      id="passphrase"
                      name="passphrase"
                      className="w-full p-2.5 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 focus:ring-indigo-500 focus:border-indigo-500 dark:focus:ring-indigo-500 dark:focus:border-indigo-500 text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" htmlFor="testType">
                      Test Type
                    </label>
                    <select
                      id="testType"
                      name="testType"
                      value={testType}
                      onChange={(e) => setTestType(e.target.value)}
                      className="w-full p-2.5 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 focus:ring-indigo-500 focus:border-indigo-500 dark:focus:ring-indigo-500 dark:focus:border-indigo-500 text-sm"
                    >
                      <option value="standard">Standard Test</option>
                      <option value="custom">Custom Test</option>
                    </select>
                  </div>
                  <div>
                    <label className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300">
                      <input
                        type="checkbox"
                        name="captureVideo"
                        className="mr-2 h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 dark:border-gray-600 rounded"
                      />
                      Capture Video for all URLs tested (not just Failed URLs)
                    </label>
                  </div>
                  <div className="flex items-center justify-between space-x-4">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" htmlFor="file">
                        Select input.xlsx
                      </label>
                      <input
                        type="file"
                        id="file"
                        name="file"
                        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        disabled={testType === 'standard'}
                        className="w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 dark:file:bg-indigo-800 file:text-indigo-700 dark:file:text-indigo-300 hover:file:bg-indigo-100 dark:hover:file:bg-indigo-700 cursor-pointer disabled:opacity-50"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={submissionStatus === 'loading'}
                      className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:opacity-60 self-end"
                    >
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

              <div className="p-4 sm:p-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg flex flex-col h-[500px]">
                <div className="flex items-center mb-4">
                  <img
                    src="https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg"
                    alt="Gemini Icon"
                    className="w-6 h-6 mr-2"
                  />
                  <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300 open-sans">Ask Gemini</h2>
                </div>
                <div className="flex flex-col flex-1">
                  <div className="flex-1 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg mb-4" style={{ maxHeight: '350px', overflowY: 'auto' }}>
                    {!isGeminiEnabled ? (
                      sortedRuns.length > 0 ? (
                        <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-line">{getInsightMessage(sortedRuns[0])}</p>
                      ) : runsLoading ? (
                        <p className="text-sm text-gray-500 dark:text-gray-400">Loading crawl data for insights...</p>
                      ) : (
                        <p className="text-sm text-gray-500 dark:text-gray-400">No crawl data available for insights.</p>
                      )
                    ) : (
                      <>
                        {runs.length > 0 && (
                          <div className="mb-2 text-left">
                            <p className="text-sm inline-block p-2 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 open-sans whitespace-pre-line">
                              <strong>Insight: </strong>
                              {getInsightMessage(sortedRuns[0])}
                            </p>
                          </div>
                        )}
                        {messages.length === 0 && !runs.length && (
                          <p className="text-sm text-gray-500 dark:text-gray-400">Ask Gemini a question...</p>
                        )}
                        {messages.map((msg, index) => (
                          <div key={index} className={`mb-2 ${msg.type === 'user' ? 'text-right' : 'text-left'}`}>
                            <p
                              className={`text-sm inline-block p-2 rounded-lg open-sans ${
                                msg.type === 'user' ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200' : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
                              }`}
                            >
                              {msg.type === 'gemini' && <strong>Gemini: </strong>}
                              {msg.content}
                            </p>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                  {geminiError && <p className="mb-2 text-sm text-red-500 dark:text-red-400">{geminiError}</p>}
                  {!isGeminiEnabled ? (
                    <form onSubmit={handleEnableGemini} className="flex items-stretch">
                      <input
                        type="text"
                        value={geminiPassphrase}
                        onChange={(e) => setGeminiPassphrase(e.target.value)}
                        placeholder="Enter passphrase to enable Gemini"
                        className="flex-1 p-2.5 border border-gray-300 dark:border-gray-600 rounded-l-lg bg-white dark:bg-gray-900 focus:ring-indigo-500 focus:border-indigo-500 dark:focus:ring-indigo-500 dark:focus:border-indigo-500 text-sm"
                      />
                      <button
                        type="submit"
                        disabled={askLoading}
                        className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-r-lg font-medium text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:opacity-60"
                      >
                        {askLoading ? 'Enabling...' : 'Enable'}
                      </button>
                    </form>
                  ) : (
                    <div className="flex items-stretch">
                      <textarea
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask about test results or QA protocol..."
                        rows="1"
                        disabled={askLoading}
                        className="flex-1 p-2.5 border border-gray-300 dark:border-gray-600 rounded-l-lg bg-white dark:bg-gray-900 focus:ring-indigo-500 focus:border-indigo-500 dark:focus:ring-indigo-500 dark:focus:border-indigo-500 text-sm resize-none"
                      />
                      <button
                        onClick={handleAskSubmit}
                        disabled={askLoading || !question.trim()}
                        className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-r-lg font-medium text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:opacity-60"
                      >
                        {askLoading ? 'Thinking...' : 'Send'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg mb-6">
              <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-3">Test Definitions & Protocol</h2>
              <div className="flex space-x-4 mb-4">
                <button
                  onClick={() => setActiveTab('testDefinitions')}
                  className={`px-4 py-2 rounded-lg ${activeTab === 'testDefinitions' ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
                >
                  Standard Tests
                </button>
                <button
                  onClick={() => setActiveTab('sfTests')}
                  className={`px-4 py-2 rounded-lg ${activeTab === 'sfTests' ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
                >
                  Screaming Frog
                </button>
              </div>

              {activeTab === 'testDefinitions' && (
                <div className="flex-grow overflow-y-auto scrollbar-thin scrollbar-thumb-gray-400 scrollbar-track-gray-100 dark:scrollbar-thumb-gray-600 dark:scrollbar-track-gray-700">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-100 dark:bg-gray-700">
                      <tr>
                        <th className="p-3">Test ID</th>
                        <th className="p-3">Title</th>
                        <th className="p-3">Description</th>
                        <th className="p-3">Method</th>
                      </tr>
                    </thead>
                    <tbody>
                      {testDefinitions.length > 0 ? (
                        testDefinitions.map((def) => (
                          <tr key={def.test_id} className="border-b border-gray-200 dark:border-gray-700">
                            <td className="p-3">{def.test_id}</td>
                            <td className="p-3">{def.title}</td>
                            <td className="p-3">{def.description}</td>
                            <td className="p-3">{def.test_method}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="4" className="p-3 text-center text-gray-500">No standard tests available.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'sfTests' && (
                <div className="flex-grow overflow-y-auto scrollbar-thin scrollbar-thumb-gray-400 scrollbar-track-gray-100 dark:scrollbar-thumb-gray-600 dark:scrollbar-track-gray-700">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-100 dark:bg-gray-700">
                      <tr>
                        <th className="p-3">Test ID</th>
                        <th className="p-3">Title</th>
                        <th className="p-3">Feature</th>
                        <th className="p-3">SF Method</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sfTests.length > 0 ? (
                        sfTests.map((test) => (
                          <tr key={test.test_id} className="border-b border-gray-200 dark:border-gray-700">
                            <td className="p-3">{test.test_id}</td>
                            <td className="p-3">{test.title || 'N/A'}</td>
                            <td className="p-3">{test.screamingfrog_feature}</td>
                            <td className="p-3">{test.screamingfrog_method}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="4" className="p-3 text-center text-gray-500">No Screaming Frog tests available.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </main>
        <footer className="text-center py-6 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 mt-10"></footer>
      </div>
    </>
  );
}