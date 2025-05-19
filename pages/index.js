import React, { useEffect, useState, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { Bar } from 'react-chartjs-2';
import Head from 'next/head';

// Moved downloadCSV outside of components
const downloadCSV = (headers, data, filename) => {
  const csv = [
    headers.join(','),
    ...data.map(row => headers.map(header => `"${row[header] || ''}"`).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const FailingTestsChart = React.memo(({ failedTests, isDarkMode, activeIssuesTab, setActiveIssuesTab }) => {
  const hasFails = failedTests && Object.keys(failedTests).length > 0;

  const data = useMemo(() => {
    if (!hasFails) return null;
    const extractNumber = (str) => {
      const match = str.match(/\d+/);
      return match ? parseInt(match[0], 10) : 0;
    };
    const sortedKeys = Object.keys(failedTests).sort((a, b) => extractNumber(a) - extractNumber(b));
    const sortedData = sortedKeys.map(key => failedTests[key]);
    return {
      labels: sortedKeys,
      datasets: [
        {
          label: 'Number of Fails',
          data: sortedData,
          backgroundColor: 'rgba(255, 99, 132, 0.6)',
          borderColor: 'rgba(255, 99, 132, 1)',
          borderWidth: 1,
        },
      ],
    };
  }, [failedTests]);

  const options = useMemo(() => ({
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
  }), [isDarkMode]);

  return (
    <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg h-full">
      <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300">Crawl Issues</h2>
        <button
          onClick={() => {
            const headers = ['Test ID', 'Number of Fails'];
            const extractNumber = (str) => {
              const match = str.match(/\d+/);
              return match ? parseInt(match[0], 10) : 0;
            };
            const sortedEntries = Object.entries(failedTests).sort((a, b) => extractNumber(a[0]) - extractNumber(b[0]));
            const data = hasFails
              ? sortedEntries.map(([testId, count]) => ({ 'Test ID': testId, 'Number of Fails': count }))
              : [];
            downloadCSV(headers, data, activeIssuesTab === 'last' ? 'last_crawl_issues.csv' : 'trended_crawl_issues.csv');
          }}
          className="text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100"
          aria-label="Download CSV"
        >
          <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
            <path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/>
          </svg>
        </button>
      </div>
      <div className="flex space-x-4 my-4">
        <button
          onClick={() => setActiveIssuesTab('last')}
          className={`w-34 px-4 py-2 rounded-lg ${activeIssuesTab === 'last' ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
        >
          Last Crawl
        </button>
        <button
          onClick={() => setActiveIssuesTab('trended')}
          className={`w-34 px-4 py-2 rounded-lg ${activeIssuesTab === 'trended' ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
        >
          Trended (Last 30)
        </button>
      </div>
      {hasFails ? (
        <div style={{ height: 'calc(100% - 120px)' }}>
          <Bar data={data} options={options} />
        </div>
      ) : (
        <p className="text-gray-500 dark:text-gray-400 text-center py-4">No fails observed in the most recent crawl.</p>
      )}
    </div>
  );
});

export default function Dashboard() {
  const [runs, setRuns] = useState([]);
  const [question, setQuestion] = useState('');
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
  const [expandedRuns, setExpandedRuns] = useState([]);
  const [activeIssuesTab, setActiveIssuesTab] = useState('last');
  const [activeInfoTab, setActiveInfoTab] = useState('about');
  const chartRef = useRef(null);
  const donutChartRef = useRef(null);

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'QAT - QA Automation Testing Dashboard',
          text: 'Check out this QA Automation Testing Dashboard!',
          url: window.location.href,
        });
      } catch (error) {
        console.error('Error sharing:', error);
      }
    } else {
      alert('Share functionality is not supported on this device. You can copy the link: ' + window.location.href);
    }
  };

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
        const sanitizedData = data.map((run, idx) => {
          const runDate = run.date ? new Date(run.date) : new Date();
          if (!run.date || isNaN(runDate.getTime())) {
            console.warn(`Invalid date for run ${run.runId || idx}: ${run.date}. Using current date.`);
          }
          const screenshots = Array.isArray(run.screenshot_paths) ? run.screenshot_paths.filter(Boolean) : [];
          const videos = Array.isArray(run.video_paths) ? run.video_paths.filter(Boolean) : [];
          return {
            ...run,
            runId: run.runId || `fallback-${idx}`,
            hasArtifacts: run.hasArtifacts ?? false,
            artifactCount: run.artifactCount || screenshots.length + videos.length,
            artifactsList: run.artifactsList || [],
            failed_urls: run.failed_urls || [],
            failed_tests: run.failed_tests || {},
            successCount: run.successCount || run.passed || run.total || 0,
            failureCount: run.failureCount || run.failed || 0,
            naCount: run.naCount || run.na || 0,
            date: runDate.toISOString(),
            screenshotPaths: screenshots,
            videoPaths: videos,
          };
        });
        console.log('Sanitized runs:', sanitizedData);
        setRuns(sanitizedData);
      } catch (err) {
        console.error('Error fetching runs:', err);
        setRuns([]);
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

        const maxTotalUrls = Math.max(
          1,
          ...recentRuns.map((run) => (run.successCount || 0) + (run.failureCount || 0) + (run.naCount || 0))
        );
        const yAxisMax = maxTotalUrls > 0 ? Math.ceil(maxTotalUrls / 5) * 5 + 5 : 10;

        if (chartRef.current.chart) chartRef.current.chart.destroy();

        const tickColor = isDarkMode ? 'rgba(229, 231, 235, 0.7)' : 'rgba(75, 85, 99, 0.7)';
        const titleColor = isDarkMode ? '#E5E7EB' : '#374151';
        const legendColor = isDarkMode ? '#E5E7EB' : '#374151';
        const datalabelColor = isDarkMode ? '#FFFFFF' : '#000000';

        const datasets = [
          { label: '# Passed', data: passedData, backgroundColor: 'rgba(75, 192, 75, 0.6)', borderColor: 'rgba(75, 192, 75, 1)', borderWidth: 1 },
          { label: '# Failed', data: failedData, backgroundColor: 'rgba(255, 99, 132, 0.6)', borderColor: 'rgba(255, 99, 132, 1)', borderWidth: 1 },
        ];
        if (naData.some(count => count > 0)) {
          datasets.push({
            label: '# N/A',
            data: naData,
            backgroundColor: 'rgba(255, 206, 86, 0.6)',
            borderColor: 'rgba(255, 206, 86, 1)',
            borderWidth: 1,
          });
        }

        chartRef.current.chart = new Chart(ctx, {
          type: 'bar',
          data: { labels, datasets },
          options: {
            scales: {
              x: {
                stacked: true,
                ticks: { autoSkip: true, maxTicksLimit: 10, maxRotation: 45, minRotation: 45, color: tickColor, callback: (value, index) => labels[index]?.split('\n') || '' },
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
            datasets: [{ data: [scheduledCount, adHocCount], backgroundColor: ['#3182ce', '#90bde9'], borderColor: [isDarkMode ? '#3182ce' : '#FFFFFF', isDarkMode ? '#90bde9' : '#FFFFFF'], borderWidth: 2, hoverOffset: 4 }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            cutout: '65%',
            plugins: {
              legend: { position: 'right', labels: { color: legendColor, boxWidth: 15, padding: 15 } },
              datalabels: { display: true, color: datalabelColor, font: { size: 16, weight: 'bold' }, formatter: (value) => (value > 0 ? value : '') },
              tooltip: {
                backgroundColor: isDarkMode ? 'rgba(40,40,40,0.9)' : ' Rgba(245,245,245,0.9)',
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

  const handleAskSubmit = async () => {
    if (!isGeminiEnabled || !question.trim()) return;
    const userQuestion = question;
    setMessages((prev) => [...prev, { type: 'user', content: userQuestion }]);
    setQuestion('');
    setAskLoading(true);
    setGeminiError('');

    try {
      const response = await fetch('/api/ask-llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: userQuestion, passphrase: storedPassphrase }),
      });
      const data = await response.json();
      if (response.ok) {
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

  const displayedRuns = showAll ? sortedRuns : sortedRuns.slice(0, 7);

  const trendedFailedTests = useMemo(() => {
    const last30Runs = sortedRuns.slice(0, 30);
    const aggregated = {};
    last30Runs.forEach(run => {
      if (run.failed_tests) {
        Object.entries(run.failed_tests).forEach(([testId, count]) => {
          aggregated[testId] = (aggregated[testId] || 0) + count;
        });
      }
    });
    return aggregated;
  }, [sortedRuns]);

  const sortByTestId = (a, b) => {
    const numA = parseInt(a.test_id.match(/\d+/)[0], 10);
    const numB = parseInt(b.test_id.match(/\d+/)[0], 10);
    return numA - numB;
  };

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
      message += 'Note: For more details, view that tests Actions and Artifacts.\n\n';
      message += 'Enable Gemini to query test results or seek insights using natural language and receive AI-driven answers.';
    } else {
      message += 'No failures.\n\n';
      message += 'Enable Gemini to query test results or seek insights using natural language and receive AI-driven answers.';
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
        <title>QAT - QA Automation Testing Dashboard</title>
        <meta name="description" content="QAT - QA Automation Testing Dashboard" />
        <meta name="robots" content="noindex" />
        <meta property="og:title" content="QAT - QA Automation Testing Dashboard" />
        <meta property="og:description" content="A dashboard for QA automation testing." />
        <meta property="og:image" content="/web-app-manifest-192x192.png" />
        <meta property="og:url" content={typeof window !== 'undefined' ? window.location.href : ''} />
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
            <div className="flex items-center mb-2 sm:mb-0">
              <img
                src="/favicon.svg"
                alt="QAT Favicon"
                className="w-6 sm:w-9 h-6 sm:h-9 mr-2"
              />
              <span className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-gray-200">
                QAT - QA Automation Testing Dashboard
              </span>
            </div>
            <div className="flex space-x-6 mb-2 sm:mb-0">
              <a href="#recent-crawls" className="text-sm text-gray-600 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400">Recent Crawls</a>
              <a href="#ask-gemini" className="text-sm text-gray-600 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400">Ask Gemini</a>
              <a href="#test-definitions" className="text-sm text-gray-600 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400">Test Definitions</a>
              <a href="#information" className="text-sm text-gray-600 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400">Instructions & Info</a>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={handleShare}
                className="p-2 rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                aria-label="Share"
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                  <path d="M240-40q-33 0-56.5-23.5T160-120v-440q0-33 23.5-56.5T240-640h120v80H240v440h480v-440H600v-80h120q33 0 56.5 23.5T800-560v440q0 33-23.5 56.5T720-40H240Zm200-280v-447l-64 64-56-57 160-160 160 160-56 57-64-64v447h-80Z"/>
                </svg>
              </button>
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
          </div>

          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
              <div className="lg:col-span-2 p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
                <div className="flex justify-between items-center mb-3">
                  <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300">Crawls Trended</h2>
                  <button
                    onClick={() => {
                      const recentRuns = [...runs].sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-24);
                      const headers = ['Date & Time', 'Passed', 'Failed', 'N/A'];
                      const data = recentRuns.map(run => ({
                        'Date & Time': new Date(run.date).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Chicago' }),
                        'Passed': run.successCount || 0,
                        'Failed': run.failureCount || 0,
                        'N/A': run.naCount || 0,
                      }));
                      downloadCSV(headers, data, 'crawls_trended.csv');
                    }}
                    className="text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100"
                    aria-label="Download CSV"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                      <path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/>
                    </svg>
                  </button>
                </div>
                <div style={{ height: '400px', width: '100%' }}>
                  <canvas ref={chartRef}></canvas>
                </div>
              </div>
              <div className="lg:col-span-1 p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg flex flex-col justify-center items-center">
                <div className="flex justify-between items-center mb-3 w-full">
                  <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300">Crawl Types</h2>
                  <button
                    onClick={() => {
                      const scheduledCount = runs.filter((run) => run.event === 'schedule').length;
                      const adHocCount = runs.filter((run) => run.event === 'workflow_dispatch').length;
                      const headers = ['Type', 'Count'];
                      const data = [
                        { Type: 'Scheduled', Count: scheduledCount },
                        { Type: 'Ad-Hoc', Count: adHocCount },
                      ];
                      downloadCSV(headers, data, 'crawl_types.csv');
                    }}
                    className="text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100"
                    aria-label="Download CSV"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                      <path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/>
                    </svg>
                  </button>
                </div>
                <div style={{ height: '400px', width: '100%', maxWidth: '380px' }}>
                  <canvas ref={donutChartRef}></canvas>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-6">
              <div className="lg:col-span-1 h-[28rem]">
                <FailingTestsChart
                  failedTests={activeIssuesTab === 'last' ? sortedRuns[0]?.failed_tests : trendedFailedTests}
                  isDarkMode={isDarkMode}
                  activeIssuesTab={activeIssuesTab}
                  setActiveIssuesTab={setActiveIssuesTab}
                />
              </div>
              <div id="recent-crawls" className="lg:col-span-3 p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg">
                <div className="sticky top-0 bg-white dark:bg-gray-800 z-20 py-2 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex justify-between items-center">
                    <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300">Recent Crawl Information</h2>
                    <div className="flex items-center space-x-4">
                      {runs.length > 5 && (
                        <button
                          onClick={() => setShowAll(!showAll)}
                          className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium transition-colors text-sm"
                        >
                          {showAll ? `Collapse (${runs.length})` : `Expand (${runs.length})`}
                        </button>
                      )}
                      <button
                        onClick={() => {
                          const headers = ['Crawl Name', 'Date & Time', 'Initiator', 'Passed', 'Failed', 'Output Artifacts'];
                          const data = displayedRuns.map(run => ({
                            'Crawl Name': run.crawlName || 'N/A',
                            'Date & Time': new Date(run.date).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Chicago' }),
                            'Initiator': run.initiator || 'N/A',
                            'Passed': run.successCount || 0,
                            'Failed': run.failureCount || 0,
                            'Output Artifacts': run.hasArtifacts ? 'Yes' : 'No',
                          }));
                          downloadCSV(headers, data, 'recent_crawls.csv');
                        }}
                        className="text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100"
                        aria-label="Download CSV"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                          <path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
                <div className="h-[23rem] overflow-y-auto">
                  {runsLoading && !runs.length ? (
                    <p className="text-gray-500 dark:text-gray-400 text-center py-4">Loading run data...</p>
                  ) : runsError ? (
                    <p className="text-red-500 dark:text-red-400 text-center py-4">{runsError}</p>
                  ) : displayedRuns.length === 0 && !runsLoading ? (
                    <p className="text-gray-500 dark:text-gray-400 text-center py-4">No crawl data available.</p>
                  ) : (
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
                          <React.Fragment key={run.runId || `run-${index}`}>
                            <tr
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
                                {run.hasArtifacts || run.screenshotPaths.length > 0 || run.videoPaths.length > 0 ? (
                                  <div className="flex items-center space-x-2">
                                    <a
                                      href={`https://github.com/rsmedstad/qa-automation-tool/actions/runs/${run.runId}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center"
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                      </svg>
                                      View Actions ({run.artifactCount || 0})
                                    </a>
                                    {(run.screenshotPaths.length > 0 || run.videoPaths.length > 0) && (
                                      <button
                                        onClick={() =>
                                          setExpandedRuns((prev) =>
                                            prev.includes(run.runId)
                                              ? prev.filter((id) => id !== run.runId)
                                              : [...prev, run.runId]
                                          )
                                        }
                                        className="text-blue-500 hover:underline text-sm"
                                      >
                                        {expandedRuns.includes(run.runId) ? 'Hide' : 'Show'} Artifacts (
                                        {run.screenshotPaths.length + run.videoPaths.length})
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-gray-500 dark:text-gray-400">None</span>
                                )}
                              </td>
                            </tr>
                            {expandedRuns.includes(run.runId) && (
                              <tr>
                                <td colSpan="6" className="p-3 bg-gray-100 dark:bg-gray-700">
                                  <div className="flex flex-wrap gap-2">
                                    {[
                                      ...run.screenshotPaths.map((url, idx) => (
                                        <a
                                          key={`screenshot-${idx}`}
                                          href={url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-blue-500 hover:underline text-sm"
                                        >
                                          Screenshot {idx + 1}
                                        </a>
                                      )),
                                      ...run.videoPaths.map((url, idx) => (
                                        <a
                                          key={`video-${idx}`}
                                          href={url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-blue-500 hover:underline text-sm"
                                        >
                                          Video {idx + 1}
                                        </a>
                                      )),
                                    ]}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-8 gap-6">
              <div className="md:col-span-3 p-4 sm:p-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg flex flex-col h-[500px]">
                <h2 className="text-xl font-semibold mb-4 text-gray-700 dark:text-gray-300">Request Ad-Hoc Crawl</h2>
                <form onSubmit={handleTestSubmit} className="flex flex-col flex-grow space-y-4">
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
                      Capture Video for Failed URLs
                    </label>
                  </div>
                  <div className="flex items-center mt-auto">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" htmlFor="file">
                        Select input.xlsx
                      </label>
                      <input
                        type="file"
                        id="file"
                        name="file"
                        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        disabled={testType === 'standard'}
                        className="text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-500 dark:file:bg-blue-600 file:text-white hover:file:bg-blue-600 dark:hover:file:bg-blue-700 cursor-pointer disabled:opacity-50"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={submissionStatus === 'loading'}
                      className="ml-auto px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:opacity-60"
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

              <div id="ask-gemini" className="md:col-span-5 p-4 sm:p-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg flex flex-col h-[500px]">
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

            <div id="test-definitions" className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg mb-6">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300">Test Definitions & Protocol</h2>
                <button
                  onClick={() => {
                    if (activeTab === 'testDefinitions') {
                      const headers = ['Test ID', 'Title', 'Description', 'Method'];
                      const data = testDefinitions.map(def => ({
                        'Test ID': def.test_id,
                        'Title': def.title,
                        'Description': def.description,
                        'Method': def.test_method,
                      }));
                      downloadCSV(headers, data, 'test_definitions.csv');
                    } else {
                      const headers = ['Test ID', 'Title', 'Feature', 'SF Method'];
                      const data = sfTests.map(test => ({
                        'Test ID': test.test_id,
                        'Title': test.title || 'N/A',
                        'Feature': test.screamingfrog_feature,
                        'SF Method': test.screamingfrog_method,
                      }));
                      downloadCSV(headers, data, 'screaming_frog_tests.csv');
                    }
                  }}
                  className="text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100"
                  aria-label="Download CSV"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                    <path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/>
                  </svg>
                </button>
              </div>
              <div className="flex space-x-4 mb-4">
                <button
                  onClick={() => setActiveTab('testDefinitions')}
                  className={`px-4 py-2 rounded-lg ${activeTab === 'testDefinitions' ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
                >
                  Standard Tests
                </button>
                <button
                  onClick={() => setActiveTab('sfTests')}
                  className={`px-4 py-2 rounded-lg ${activeTab === 'sfTests' ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-grey-700 dark:text-gray-300'}`}
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
                        testDefinitions.sort(sortByTestId).map((def) => (
                          <tr key={def.test_id} className="border-b border-gray-200 dark:border-gray-700">
                            <td className="p-3">{def.test_id}</td>
                            <td className="p-3">{def.title}</td>
                            <td className="p-3">{def.description}</td>
                            <td className="p-3 whitespace-normal break-words">{def.test_method}</td>
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
                        sfTests.sort(sortByTestId).map((test) => (
                          <tr key={test.test_id} className="border-b border-gray-200 dark:border-gray-700">
                            <td className="p-3">{test.test_id}</td>
                            <td className="p-3">{test.title || 'N/A'}</td>
                            <td className="p-3">{test.screamingfrog_feature}</td>
                            <td className="p-3 whitespace-normal break-words">{test.screamingfrog_method}</td>
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

            <div id="information" className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg mb-6">
              <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-4">Information</h2>
              <div className="flex space-x-4 mb-4">
                <button
                  onClick={() => setActiveInfoTab('about')}
                  className={`px-4 py-2 rounded-lg ${activeInfoTab === 'about' ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
                >
                  About
                </button>
                <button
                  onClick={() => setActiveInfoTab('instructions')}
                  className={`px-4 py-2 rounded-lg ${activeInfoTab === 'instructions' ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
                >
                  Instructions
                </button>
              </div>
              <div className="min-h-[640px]">
                {activeInfoTab === 'about' && (
                  <div className="prose dark:prose-invert max-w-none">
                    <h3>Description</h3>
                    <p>
                      The QA Automation Tool simplifies web application quality assurance by automating a suite of predefined tests on specified URLs. It ensures websites meet high standards by checking elements like page structure, functionality, and performance. The dashboard serves as a central hub, offering real-time insights into test results, visual trends, and the ability to launch tests on demand—empowering teams to maintain excellence effortlessly.
                    </p>
                    <h3>Technology Stack</h3>
                    <ul>
                      <li><strong>Node.js & Next.js</strong>: Powers the backend logic and responsive frontend.</li>
                      <li><strong>Playwright</strong>: Drives robust browser automation for reliable testing.</li>
                      <li><strong>Supabase</strong>: Manages test data and results with a scalable database.</li>
                      <li><strong>Vercel</strong>: Hosts the app and stores artifacts like screenshots and videos.</li>
                      <li><strong>GitHub Actions</strong>: Automates testing workflows for consistency and efficiency.</li>
                      <li><strong>ExcelJS</strong>: Processes input and output data in familiar Excel formats.</li>
                      <li><strong>Chart.js</strong>: Visualizes test trends with clear, interactive charts.</li>
                      <li><strong>Gemini & LangChain</strong>: Enable natural language queries with AI-driven insights.</li>
                    </ul>
                    <h3>Author Information</h3>
                    <p>
                      Made by: Ryan Smedstad<br />
                      GitHub: <a href="https://github.com/rsmedstad" target="_blank" rel="noopener noreferrer">rsmedstad</a><br />
                      Project Repo: <a href="https://github.com/rsmedstad/qa-automation-tool" target="_blank" rel="noopener noreferrer">qa-automation-tool</a>
                    </p>
                  </div>
                )}
                {activeInfoTab === 'instructions' && (
                  <div className="prose dark:prose-invert max-w-none">
                    <h3>Instructions</h3>
                    <h4>Using the Dashboard</h4>
                    <ul>
                      <li><strong>Reading the Dashboard</strong>: View recent test runs with summaries of passed, failed, and N/A results. Charts highlight trends and pinpoint issues at a glance.</li>
                      <li><strong>Ask Gemini Feature</strong>: Query test results or seek insights using natural language—unlock this with a passphrase for smart, AI-driven answers.</li>
                      <li><strong>Scheduled vs. Ad-hoc Crawls</strong>: Scheduled tests run automatically every three hours, while ad-hoc tests let you test immediately as needed.</li>
                      <li><strong>How to Run an Ad-hoc Crawl</strong>: In the "Request Ad-Hoc Crawl" section, enter your name, passphrase, and optionally upload a custom <a href="https://github.com/rsmedstad/qa-automation-tool/raw/225b4193b5f7ecce8813334f3c7763dfc27a0b5a/input.xlsx" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">input.xlsx</a> file. Click "Run Test" to start.</li>
                      <li><strong>Getting Test Run Details via GitHub Actions & Artifacts</strong>: Each test generates artifacts (e.g., results-run_id.xlsx, screenshots, videos for failures). These can be accessed from the Recent Crawl Information table or via GitHub Actions:
                        <ol>
                          <li>Go to <a href="https://github.com/rsmedstad/qa-automation-tool/actions" target="_blank" rel="noopener noreferrer">github.com/rsmedstad/qa-automation-tool/actions</a>.</li>
                          <li>Select a run, scroll to "Artifacts," and download files like results or media.</li>
                        </ol>
                      </li>
                    </ul>
                    <h4>How to Test Manually with Screaming Frog</h4>
                    <ul>
                      <li>See the "Screaming Frog" tab in "Test Definitions & Protocol" for steps to replicate tests manually.</li>
                      <li>Please note that if testing with Screaming Frog, you will need to have a paid version of the software to utilize Custom Extraction features.</li>
                      <li>The Screaming Frog application can be downloaded directly from their website and a license key can be requested from MyTech.</li>
                    </ul>
                    <h4>Contact</h4>
                    <ul>
                      <li>For questions or feedback, reach out to Ryan Smedstad.</li>
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
        <footer className="text-center py-1 text-xs text-gray-500 dark:text-gray-300 ">
          <p className="flex items-center justify-center gap-2">
            <a href="https://github.com/rsmedstad" target="_blank" rel="noopener noreferrer" className="inline-flex items-center hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors" aria-label="Ryan Smedstad's GitHub Profile">
              Developed by Ryan Smedstad 
              <svg className="w-6 h-6 github-icon" viewBox="0 0 17 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path fillRule="evenodd" clipRule="evenodd" d="M8.5 2.22168C5.23312 2.22168 2.58496 4.87398 2.58496 8.14677C2.58496 10.7642 4.27962 12.9853 6.63026 13.7684C6.92601 13.8228 7.03366 13.6401 7.03366 13.4827C7.03366 13.3425 7.02893 12.9693 7.02597 12.4754C5.38041 12.8333 5.0332 11.681 5.0332 11.681C4.76465 10.996 4.37663 10.8139 4.37663 10.8139C3.83954 10.4471 4.41744 10.4542 4.41744 10.4542C5.01072 10.4956 5.32303 11.0647 5.32303 11.0647C5.85065 11.9697 6.70774 11.7082 7.04431 11.5568C7.09873 11.1741 7.25134 10.9132 7.42051 10.7654C6.10737 10.6157 4.72621 10.107 4.72621 7.83683C4.72621 7.19031 4.95689 6.66092 5.33486 6.24686C5.27394 6.09721 5.07105 5.49447 5.39283 4.67938C5.39283 4.67938 5.88969 4.51967 7.01947 5.28626C7.502 5.15466 7.99985 5.08763 8.5 5.08692C9.00278 5.08929 9.50851 5.15495 9.98113 5.28626C11.1103 4.51967 11.606 4.67879 11.606 4.67879C11.9289 5.49447 11.7255 6.09721 11.6651 6.24686C12.0437 6.66092 12.2732 7.19031 12.2732 7.83683C12.2732 10.1129 10.8897 10.6139 9.5724 10.7606C9.78475 10.9434 9.97344 11.3048 9.97344 11.8579C9.97344 12.6493 9.96634 13.2887 9.96634 13.4827C9.96634 13.6413 10.0728 13.8258 10.3733 13.7678C12.7239 12.9837 14.415 10.7633 14.415 8.14677C14.415 4.87398 11.7663 2.22168 8.5 2.22168Z" fill="currentColor"/>
              </svg>
            </a>
          </p>
        </footer>
      </div>
    </>
  );
}