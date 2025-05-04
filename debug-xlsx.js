import XLSX from 'xlsx';

const filePath = process.argv[2] || 'input.xlsx';

try {
  // Read the workbook
  const wb = XLSX.readFile(filePath);
  console.log('Sheet Names:', wb.SheetNames);

  // Check for "URLs" sheet
  const sheetName = 'URLs';
  if (!wb.SheetNames.includes(sheetName)) {
    console.error(`Sheet "${sheetName}" not found. Available sheets:`, wb.SheetNames);
    process.exit(1);
  }

  // Get the sheet
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet);
  console.log('First 5 rows:', rows.slice(0, 5));

  // Check for URLs under common headers
  const urlHeaders = ['URL', 'Urls', 'url']; // Add more if needed
  let urlsFound = [];
  rows.forEach((row, index) => {
    for (const header of urlHeaders) {
      if (row[header]) {
        urlsFound.push({ row: index + 2, url: row[header] }); // Row number starts at 2 (header row = 1)
      }
    }
  });

  if (urlsFound.length > 0) {
    console.log('Found URLs:', urlsFound);
  } else {
    console.error('No URLs found under headers:', urlHeaders);
  }
} catch (error) {
  console.error('Error reading XLSX file:', error.message);
  process.exit(1);
}