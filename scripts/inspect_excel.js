import XLSX from 'xlsx';

const workbook = XLSX.readFile('clientes_402920_1786899096.xlsx');
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(sheet);

console.log(`Total rows: ${data.length}`);

const allKeys = new Set();
data.forEach(row => {
  Object.keys(row).forEach(k => allKeys.add(k));
});

console.log('All unique columns across sheet:', Array.from(allKeys));
console.log('\nSample rows with various fields:');
data.slice(0, 5).forEach((r, idx) => console.log(`Row ${idx}:`, JSON.stringify(r)));
