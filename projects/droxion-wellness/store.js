const fs = require('node:fs')
const { Pool } = require('pg')
const catalog = require('./catalog.json')
const {defaults} = require('./views')

async function migrate(db) {
  await db.query('BEGIN')
  try {
    await db.query('SELECT pg_advisory_xact_lock(63051237)')
    await db.query(fs.readFileSync(require.resolve('./schema.sql'), 'utf8'))
    for (const p of catalog) await db.query('INSERT INTO products VALUES ($1,true,$2) ON CONFLICT DO NOTHING',[p.slug,p])
    await db.query('INSERT INTO settings VALUES (true,$1) ON CONFLICT DO NOTHING',[defaults])
    await db.query('DELETE FROM admin_sessions WHERE expires_at <= now()')
    await db.query('DELETE FROM events WHERE at < now() - interval \'180 days\'')
    await db.query('COMMIT')
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  }
}
async function connect() {
  if (!process.env.DATABASE_URL) return null
  const pool = new Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:12000})
  pool.on('error', error=>console.error('Database pool error',error.code))
  const conn = await pool.connect()
  try { await migrate(conn) } finally { conn.release() }
  return pool
}
async function transaction(db, fn) {
  const conn = await db.connect()
  try {
    await conn.query('BEGIN')
    const result = await fn(conn)
    await conn.query('COMMIT')
    return result
  } catch (error) {
    await conn.query('ROLLBACK')
    throw error
  } finally {
    conn.release()
  }
}
const audit = (db, action, target) => db.query('INSERT INTO audit_log(action,target) VALUES ($1,$2)',[action,target])
const financeFields = {
  sale:'Selling price ($)', manufacturing:'Manufacturing cost per unit ($)', inbound:'Inbound shipping per unit ($)',
  packaging:'Packaging per unit ($)', shipping:'Customer shipping per unit ($)', marketplace:'Marketplace fees (%)',
  processing:'Payment processing (%)', paymentFixed:'Fixed payment fee ($)', ads:'Advertising per unit ($)', returns:'Return reserve per unit ($)',
  volume:'Monthly units', inventory:'Inventory units'
}
function calculate(f) {
  const fixed = f.manufacturing+f.inbound+f.packaging+f.shipping+f.paymentFixed+f.ads+f.returns
  const percentage = (f.marketplace+f.processing)/100
  const cost = fixed + f.sale*percentage
  const contribution = f.sale-cost
  return {cost, contribution, margin:f.sale ? contribution/f.sale*100 : null, breakeven:percentage<1 ? Math.ceil(fixed/(1-percentage)*100)/100 : null,
    monthly:contribution*f.volume, inventory:(f.manufacturing+f.inbound+f.packaging)*f.inventory}
}
module.exports = { connect, migrate, transaction, audit, financeFields, calculate }
