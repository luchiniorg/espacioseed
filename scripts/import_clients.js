import XLSX from 'xlsx';
import fs from 'fs';

const workbook = XLSX.readFile('clientes_402920_1786899096.xlsx');
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(sheet);

console.log(`Leyendo ${data.length} filas del archivo Excel...`);

function escapeSql(val) {
  if (val === null || val === undefined || val === '') return 'NULL';
  const str = String(val).replace(/'/g, "''").trim();
  return `'${str}'`;
}

function escapeSqlNum(val) {
  if (val === null || val === undefined || val === '' || isNaN(val)) return 'NULL';
  return parseInt(val, 10);
}

const statements = [];

data.forEach((row, idx) => {
  const nombres = (row['Nombres'] || '').toString().trim();
  const apellidos = (row['Apellidos'] || '').toString().trim();
  const name = `${nombres} ${apellidos}`.trim() || 'Sin Nombre';

  const email = (row['Email'] || '').toString().trim().toLowerCase() || `cliente_${idx + 1}@espacioseed.com`;
  const phone = (row['Teléfono'] || '').toString().trim();
  const dni = (row['DNI'] || '').toString().trim();
  const age = row['Edad'];
  
  let gender = null;
  const genVal = row['Género. 1 = Femenino, 2 = Masculino'];
  if (genVal == 1) gender = 'Femenino';
  else if (genVal == 2) gender = 'Masculino';

  let birthdate = null;
  const dia = row['Día del nacimiento'];
  const mes = row['Mes del nacimiento'];
  const anio = row['Año de nacimiento.'];
  if (dia && mes && anio) {
    birthdate = `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }

  const createdAt = (row['Fecha de creación.'] || '').toString().trim();
  const id = `cli_${idx + 1}_` + Math.random().toString(36).substring(2, 9);

  const sql = `INSERT INTO clients (id, name, email, phone, dni, age, gender, birthdate, created_at) VALUES (${escapeSql(id)}, ${escapeSql(name)}, ${escapeSql(email)}, ${escapeSql(phone)}, ${escapeSql(dni)}, ${escapeSqlNum(age)}, ${escapeSql(gender)}, ${escapeSql(birthdate)}, ${escapeSql(createdAt || new Date().toISOString())});`;

  statements.push(sql);
});

const sqlFilePath = 'drizzle/import_clients.sql';
fs.writeFileSync(sqlFilePath, statements.join('\n'), 'utf8');

console.log(`✓ Archivo SQL generado exitosamente: ${sqlFilePath} con ${statements.length} sentencias INSERT.`);
