const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { after, before, test } = require('node:test')
const Database = require('better-sqlite3')
const { io } = require('socket.io-client')
const jwt = require('jsonwebtoken')
const sharp = require('sharp')
const XLSX = require('xlsx')
const JSZip = require('jszip')
const { CURRENT_SCHEMA_VERSION } = require('../src/schema-version')

let child
let baseUrl
let cookie
let adminCookie
let operationsCookie
let salesCookie
let tempRoot
let testServerPort
const testJwtSecret = 'test-only-jwt-signing-secret-with-more-than-32-bytes'

function spawnTestServer() {
  return spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      DATABASE_URL: `file:${path.join(tempRoot, 'test.sqlite')}`,
      DB_PATH: path.join(tempRoot, 'test.sqlite'),
      STORAGE_ROOT_PATH: path.join(tempRoot, 'storage'),
      BACKUP_ROOT_PATH: path.join(tempRoot, 'Backups'),
      THUMBNAIL_CACHE_PATH: path.join(tempRoot, 'thumbnail-cache'),
      MADAR_TEST_CLIENT_BUILD_DIR: path.join(tempRoot, 'client-build'),
      PHOTO_UPLOAD_MAX_REQUEST_BYTES: String(1024 * 1024),
      PHOTO_UPLOAD_MAX_CONCURRENT: '1',
      LOGIN_DELAY_BASE_MS: '1',
      LOGIN_DELAY_MAX_MS: '2',
      LOGIN_DELAY_WINDOW_MS: '1000',
      JWT_SECRET: testJwtSecret,
      PORT: String(testServerPort),
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function waitForTestServer(server) {
  return new Promise((resolve, reject) => {
    let output = ''
    const timeout = setTimeout(() => reject(new Error(`Test API did not start: ${output}`)), 20000)
    server.stdout.on('data', (chunk) => {
      output += chunk.toString()
      if (output.includes('Madar ERP listening')) { clearTimeout(timeout); resolve() }
    })
    server.stderr.on('data', (chunk) => { output += chunk.toString() })
    server.once('error', (error) => { clearTimeout(timeout); reject(error) })
    server.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Test API exited (${code}): ${output}`)) })
  })
}

before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'madar-api-test-'))
  const testBuild = path.join(tempRoot, 'client-build')
  fs.mkdirSync(testBuild, { recursive: true })
  fs.writeFileSync(path.join(testBuild, 'index.html'), '<div id="root"></div>')
  const probe = net.createServer()
  await new Promise((resolve, reject) => probe.listen(0, '127.0.0.1', resolve).once('error', reject))
  testServerPort = probe.address().port
  await new Promise((resolve) => probe.close(resolve))
  baseUrl = `http://127.0.0.1:${testServerPort}/api`
  child = spawnTestServer()
  await waitForTestServer(child)
})

after(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve))
    child.kill()
    await exited
  }
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true })
})

async function request(route, { method = 'GET', body, form, headers: extraHeaders = {}, authCookie = cookie } = {}) {
  const headers = { ...extraHeaders }
  if (authCookie) headers.Cookie = authCookie
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let response
  try {
    response = await fetch(`${baseUrl}${route}`, {
      method,
      headers,
      body: form || (body === undefined ? undefined : JSON.stringify(body)),
    })
  } catch (error) {
    error.message = `Request ${method} ${route} failed: ${error.message}`
    throw error
  }
  const contentType = response.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await response.json() : await response.arrayBuffer()
  return { response, data }
}

async function waitForProcessingJob(orderId, timeoutMs = 15000, onStatus) {
  const deadline = Date.now() + timeoutMs
  let status
  while (Date.now() < deadline) {
    const response = await request(`/orders/${orderId}/processing-status`)
    status = response.data
    onStatus?.(status)
    if (['completed', 'failed', 'idle'].includes(status.status)) return status
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Timed out waiting for image processing job: ${JSON.stringify(status)}`)
}

async function connectSocket(authCookie) {
  const socket = io(new URL(baseUrl).origin, {
    transports: ['websocket'], timeout: 5000, reconnection: false, autoConnect: false,
    extraHeaders: authCookie ? { Cookie: authCookie } : {},
  })
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('connect_error', reject)
    socket.connect()
  })
  return socket
}

test('purchase, fractional issue, sales and treasury stay in sync in SQLite', async () => {
  const homeResponse = await fetch(new URL('/', baseUrl))
  assert.equal(homeResponse.status, 200)
  assert.match(homeResponse.headers.get('content-type'), /text\/html/)
  assert.match(await homeResponse.text(), /<div id="root"><\/div>/)

  const unauthenticatedStatus = await request('/auth/status', { authCookie: null })
  assert.deepEqual(unauthenticatedStatus.data, { needsSetup: true, user: null })
  assert.equal((await request('/bootstrap', { authCookie: null })).response.status, 401)
  assert.equal((await request('/operations/status', { authCookie: null })).response.status, 401)

  const setup = await request('/auth/setup', {
    method: 'POST',
    body: { username: 'test-admin', password: 'test-password-123', fullName: 'Test Admin' },
  })
  assert.equal(setup.response.status, 201)
  assert.equal(setup.data.user.isMaster, true)
  cookie = setup.response.headers.get('set-cookie').split(';')[0]
  adminCookie = cookie
  const jwtToken = decodeURIComponent(cookie.slice('madar_session='.length))
  const jwtClaims = jwt.verify(jwtToken, testJwtSecret, { algorithms: ['HS256'], issuer: 'madar-erp', audience: 'madar-client' })
  assert.equal(jwtClaims.role, 'admin')
  assert.ok(jwtClaims.exp > jwtClaims.iat)
  assert.equal(jwtClaims.exp - jwtClaims.iat, 7 * 24 * 60 * 60)
  const initialOperationsStatus = await request('/operations/status')
  assert.equal(initialOperationsStatus.response.status, 200)
  assert.equal(initialOperationsStatus.data.ready, true)
  assert.deepEqual(initialOperationsStatus.data.pendingRecovery, { filesystemOperations: 0, orderDeletionStages: 0, total: 0 })
  assert.equal(JSON.stringify(initialOperationsStatus.data).includes(tempRoot), false)
  const invalidKnownUserLogin = await request('/auth/login', {
    method: 'POST', body: { username: 'test-admin', password: 'invalid-password' }, authCookie: null,
  })
  const invalidUnknownUserLogin = await request('/auth/login', {
    method: 'POST', body: { username: 'unknown-admin', password: 'invalid-password' }, authCookie: null,
  })
  assert.equal(invalidKnownUserLogin.response.status, 401)
  assert.equal(invalidUnknownUserLogin.response.status, 401)
  assert.equal(invalidKnownUserLogin.data.error, invalidUnknownUserLogin.data.error)
  const [tokenHeader, tokenPayload, tokenSignature] = jwtToken.split('.')
  const tamperedSignature = `${tokenSignature[0] === 'a' ? 'b' : 'a'}${tokenSignature.slice(1)}`
  const tamperedCookie = `madar_session=${tokenHeader}.${tokenPayload}.${tamperedSignature}`
  assert.equal((await request('/bootstrap', { authCookie: tamperedCookie })).response.status, 401)

  const operationsUser = await request('/users', {
    method: 'POST', body: { username: 'test-operations', password: 'operations-password-123', fullName: 'Test Operations', role: 'operations' },
  })
  await request('/users', {
    method: 'POST', body: { username: 'test-sales', password: 'sales-password-123', fullName: 'Test Sales', role: 'sales' },
  })
  const operationsLoginForSocket = await request('/auth/login', {
    method: 'POST', body: { username: 'test-operations', password: 'operations-password-123' },
  })
  operationsCookie = operationsLoginForSocket.response.headers.get('set-cookie').split(';')[0]
  const salesLogin = await request('/auth/login', {
    method: 'POST', body: { username: 'test-sales', password: 'sales-password-123' },
  })
  salesCookie = salesLogin.response.headers.get('set-cookie').split(';')[0]
  cookie = adminCookie
  assert.equal((await request(`/users/${setup.data.user.id}`, { method: 'DELETE' })).response.status, 403)

  const forbiddenUsersExport = await request('/users/export', { authCookie: salesCookie })
  assert.equal(forbiddenUsersExport.response.status, 403)
  const usersExport = await request('/users/export')
  assert.equal(usersExport.response.status, 200)
  assert.match(usersExport.response.headers.get('content-type'), /spreadsheetml/)
  const exportedUsersWorkbook = XLSX.read(Buffer.from(usersExport.data), { type: 'buffer' })
  const exportedUserRows = XLSX.utils.sheet_to_json(exportedUsersWorkbook.Sheets[exportedUsersWorkbook.SheetNames[0]], {
    header: 1, defval: '', raw: false,
  })
  assert.deepEqual(exportedUserRows[0], ['الاسم الكامل', 'اسم المستخدم', 'كلمة المرور', 'الدور', 'الحالة'])
  const exportedOperationsUser = exportedUserRows.find((row) => row[1] === 'test-operations')
  assert.ok(exportedOperationsUser)
  assert.equal(exportedOperationsUser[2], '')
  assert.equal(exportedUserRows.flat().includes('operations-password-123'), false)

  const makeUsersWorkbook = (rows) => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['الاسم الكامل', 'اسم المستخدم', 'كلمة المرور', 'الدور', 'الحالة'],
      ...rows,
    ]), 'المستخدمون')
    return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' })
  }
  const usersImportForm = new FormData()
  usersImportForm.append('file', new Blob([makeUsersWorkbook([
    ['Test Operations', 'test-operations', '', 'operations', 'نشط'],
    ['Batch Worker', 'batch-worker', 'batch-password-123', 'operations', 'نشط'],
  ])], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'users.xlsx')
  const usersImport = await request('/users/import', { method: 'POST', form: usersImportForm })
  assert.equal(usersImport.response.status, 200)
  assert.deepEqual(usersImport.data, { added: 1, updated: 1, total: 2 })
  const usersImportArchive = await fs.promises.readdir(path.join(tempRoot, 'storage', 'Uploads', 'Excel'))
  assert.equal(usersImportArchive.some((name) => /^Users_Import_/i.test(name)), false)
  const malformedUsersForm = new FormData()
  malformedUsersForm.append('file', new Blob(['not an excel workbook']), 'broken.xlsx')
  assert.equal((await request('/users/import', { method: 'POST', form: malformedUsersForm })).response.status, 400)
  const importedUsers = await request('/users')
  assert.equal(importedUsers.data.find((user) => user.username === 'test-operations').id, operationsUser.data.id)
  assert.equal(importedUsers.data.find((user) => user.username === 'batch-worker').role, 'operations')
  const roleUpdateForm = new FormData()
  roleUpdateForm.append('file', new Blob([makeUsersWorkbook([
    ['Batch Worker', 'batch-worker', '', 'sales', 'نشط'],
  ])], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'role-update.xlsx')
  const roleUpdate = await request('/users/import', { method: 'POST', form: roleUpdateForm })
  assert.equal(roleUpdate.response.status, 200)
  assert.deepEqual(roleUpdate.data, { added: 0, updated: 1, total: 1 })
  assert.equal((await request('/users')).data.find((user) => user.username === 'batch-worker').role, 'sales')
  const importedUserLogin = await request('/auth/login', {
    method: 'POST', body: { username: 'batch-worker', password: 'batch-password-123' },
  })
  assert.equal(importedUserLogin.response.status, 200)

  const rollbackImportForm = new FormData()
  rollbackImportForm.append('file', new Blob([makeUsersWorkbook([
    ['Temporary User', 'rollback-user', 'rollback-password-123', 'operations', 'نشط'],
    ['No Password', 'blank-password-user', '', 'sales', 'نشط'],
  ])], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'rollback.xlsx')
  const rolledBackUsersImport = await request('/users/import', { method: 'POST', form: rollbackImportForm })
  assert.equal(rolledBackUsersImport.response.status, 400)
  assert.equal((await request('/users')).data.some((user) => user.username === 'rollback-user'), false)
  assert.equal((await fs.promises.readdir(path.join(tempRoot, 'storage', 'Uploads', 'Excel')))
    .some((name) => /^Users_Import_/i.test(name)), false)

  const importFailureDb = new Database(path.join(tempRoot, 'test.sqlite'))
  importFailureDb.exec(`CREATE TRIGGER reject_isolated_user_import BEFORE INSERT ON users
    WHEN NEW.username='db-fail-user' BEGIN SELECT RAISE(ABORT,'isolated import failure'); END`)
  importFailureDb.close()
  const databaseFailureForm = new FormData()
  databaseFailureForm.append('file', new Blob([makeUsersWorkbook([
    ['Database Failure User', 'db-fail-user', 'temporary-password-123', 'admin', 'نشط'],
  ])], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'database-failure.xlsx')
  const databaseFailure = await request('/users/import', { method: 'POST', form: databaseFailureForm })
  assert.equal(databaseFailure.response.status, 409)
  const removeImportFailureTrigger = new Database(path.join(tempRoot, 'test.sqlite'))
  removeImportFailureTrigger.exec('DROP TRIGGER reject_isolated_user_import')
  removeImportFailureTrigger.close()
  assert.equal((await request('/users')).data.some((user) => user.username === 'db-fail-user'), false)
  assert.equal((await fs.promises.readdir(path.join(tempRoot, 'storage', 'Uploads', 'Excel')))
    .some((name) => /^Users_Import_/i.test(name)), false)

  const client = await request('/clients', { method: 'POST', body: { name: 'Test client' } })
  assert.equal(client.response.status, 201)
  const clientList = await request('/clients')
  assert.equal(clientList.response.status, 200)
  const listedClient = clientList.data.find((item) => item.id === client.data.id)
  assert.equal(listedClient.name, 'Test client')
  assert.ok(listedClient.created_at)
  assert.equal(listedClient.deleted_at, null)
  const clientUpdate = await request(`/clients/${client.data.id}`, { method: 'PUT', body: { phone: '555-0100' } })
  assert.equal(clientUpdate.response.status, 200)
  const clientPatch = await request(`/clients/${client.data.id}`, { method: 'PATCH', body: { email: 'test@example.com' } })
  assert.equal(clientPatch.response.status, 200)
  const updatedClientList = await request('/clients')
  const updatedClient = updatedClientList.data.find((item) => item.id === client.data.id)
  assert.equal(updatedClient.phone, '555-0100')
  assert.equal(updatedClient.email, 'test@example.com')

  const maintenanceEmployee = await request('/employees', {
    method: 'POST', body: { name: 'Test Maintenance', department: 'Maintenance', phone: '555-0199' },
  })
  assert.equal(maintenanceEmployee.response.status, 201)
  assert.equal(maintenanceEmployee.data.username, '')
  const funding = await request('/treasury/funding', {
    method: 'POST', body: { amount: 1000, reference: 'TEST-OPENING-FUNDING', notes: 'Isolated API fixture only' },
  })
  assert.equal(funding.response.status, 201)
  assert.equal(funding.data.classification, 'non_revenue')
  const loginEmployee = await request('/employees', {
    method: 'POST', body: { name: 'Test Purchasing', department: 'Purchasing', username: 'employee-purchasing', password: 'employee-password-123' },
  })
  assert.equal(loginEmployee.response.status, 201)
  assert.equal(loginEmployee.data.username, 'employee-purchasing')
  const employeeDb = new Database(path.join(tempRoot, 'test.sqlite'), { readonly: true })
  try {
    const linkedUser = employeeDb.prepare('SELECT password_hash,employee_id,role FROM users WHERE username=?').get('employee-purchasing')
    assert.equal(linkedUser.employee_id, loginEmployee.data.id)
    assert.equal(linkedUser.role, 'purchasing')
    assert.notEqual(linkedUser.password_hash, 'employee-password-123')
  } finally { employeeDb.close() }
  const maintenanceEmployees = await request('/employees?department=Maintenance')
  assert.equal(maintenanceEmployees.response.status, 200)
  assert.deepEqual(maintenanceEmployees.data.map((employee) => employee.department), ['Maintenance'])
  assert.equal((await request('/employees?department=Unknown')).response.status, 400)
  assert.equal((await request('/employees', {
    method: 'POST', authCookie: salesCookie, body: { name: 'Unauthorized employee', department: 'Maintenance' },
  })).response.status, 403)
  const staffRoster = await request('/staff')
  assert.equal(staffRoster.response.status, 200)
  assert.ok(staffRoster.data.some((employee) => employee.id === maintenanceEmployee.data.id))
  const employeeLogin = await request('/auth/login', { method: 'POST', body: {
    username: 'employee-purchasing', password: 'employee-password-123',
  } })
  assert.equal(employeeLogin.response.status, 200)
  const employeeCookie = employeeLogin.response.headers.get('set-cookie').split(';')[0]
  const disabledEmployeeLogin = await request(`/staff/${loginEmployee.data.id}`, { method: 'PATCH', body: {
    name: 'Test Purchasing', department: 'Purchasing', phone: '', monthlyBaseSalary: 0,
    canLogin: false, active: true,
  } })
  assert.equal(disabledEmployeeLogin.response.status, 200, disabledEmployeeLogin.data.error)
  assert.equal((await request('/bootstrap', { authCookie: employeeCookie })).response.status, 401)
  const disabledUserState = new Database(path.join(tempRoot, 'test.sqlite'), { readonly: true })
  try {
    assert.equal(disabledUserState.prepare('SELECT active FROM users WHERE username=?').get('employee-purchasing').active, 0)
    assert.equal(disabledUserState.prepare(`SELECT COUNT(*) AS count FROM sessions
      WHERE user_id=(SELECT id FROM users WHERE username=?)`).get('employee-purchasing').count, 0)
  } finally { disabledUserState.close() }
  const attendanceOne = await request('/staff/attendance/mark-all-present', {
    method: 'POST', body: { date: '2026-09-01' },
  })
  assert.equal(attendanceOne.response.status, 200)
  const attendanceTwo = await request('/staff/attendance/mark-all-present', {
    method: 'POST', body: { date: '2026-09-02' },
  })
  assert.equal(attendanceTwo.response.status, 200)
  for (const date of ['2026-09-01', '2026-09-02']) {
    const dayAttendance = await request(`/staff/attendance/${date}`, { method: 'PUT', body: { entries: [{
      employeeId: maintenanceEmployee.data.id, status: 'absent', overtimeMinutes: 30,
      holidayOvertimeMinutes: 30, notes: 'isolated attendance test',
    }] } })
    assert.equal(dayAttendance.response.status, 200, dayAttendance.data.error)
  }
  const invalidAttendanceDate = await request('/staff/attendance?date=2026-02-30')
  assert.equal(invalidAttendanceDate.response.status, 400)

  const custodyEmployee = await request('/staff', {
    method: 'POST', body: { name: 'Custody Clearance Test', jobTitle: 'Field technician', department: 'Maintenance' },
  })
  assert.equal(custodyEmployee.data.jobTitle, 'Field technician')
  const issuedTool = await request(`/staff/${custodyEmployee.data.id}/tools`, {
    method: 'POST', body: { toolName: 'Impact driver', serialNumber: 'CUSTODY-API-1' },
  })
  assert.equal(issuedTool.response.status, 201, issuedTool.data.error)
  assert.equal((await request(`/staff/${custodyEmployee.data.id}`, { method: 'DELETE' })).response.status, 409)
  const returnedTool = await request(`/staff/tools/${issuedTool.data.id}/return`, { method: 'POST', body: {} })
  assert.equal(returnedTool.response.status, 200, returnedTool.data.error)
  assert.equal(returnedTool.data.return_status, 'returned')
  assert.equal((await request(`/staff/${custodyEmployee.data.id}`, { method: 'DELETE' })).response.status, 200)

  const temporaryClient = await request('/clients', { method: 'POST', body: { name: 'Soft delete client' } })
  assert.equal((await request(`/clients/${temporaryClient.data.id}`, { method: 'DELETE' })).response.status, 200)
  assert.equal((await request('/clients')).data.some((item) => item.id === temporaryClient.data.id), false)

  const material = await request('/materials', {
    method: 'POST',
    body: { name: 'Test sheet', unit: 'لوح', stock: 5, unitCost: 100, minStock: 1 },
  })
  assert.equal(material.response.status, 201)
  const duplicateMaterial = await request('/materials', {
    method: 'POST', body: { name: 'Test sheet', unit: 'لوح' },
  })
  assert.equal(duplicateMaterial.response.status, 201)
  assert.notEqual(duplicateMaterial.data.id, material.data.id)
  const materialUpdate = await request(`/materials/${material.data.id}`, {
    method: 'PUT', body: { name: 'Test sheet updated', minStock: 2 },
  })
  assert.equal(materialUpdate.response.status, 200)
  const materialList = await request('/materials')
  assert.equal(materialList.response.status, 200)
  assert.equal(materialList.data.find((item) => item.id === material.data.id).unitCost, 100)
  assert.equal(materialList.data.find((item) => item.id === material.data.id).name, 'Test sheet updated')
  const operationsMaterialList = await request('/materials', { authCookie: operationsCookie })
  assert.equal(operationsMaterialList.data.find((item) => item.id === material.data.id).unitCost, 0)

  assert.equal((await request('/warehouse/offcuts', { authCookie: null })).response.status, 401)
  assert.equal((await request('/warehouse/offcuts', { authCookie: salesCookie })).response.status, 403)
  assert.equal((await request('/warehouse/scrap-sales', { authCookie: null, method: 'POST', body: {} })).response.status, 401)
  const offcut = await request('/warehouse/offcuts', { method: 'POST', body: {
    materialId: material.data.id, name: 'Acrylic remnant', dimensions: '50x50 cm', quantity: 0.5, unit: 'sheet',
  } })
  assert.equal(offcut.response.status, 201, offcut.data.error)
  assert.equal((await request('/warehouse/scrap-sales', { authCookie: salesCookie, method: 'POST', body: {
    amount: 15, items: [{ offcutId: offcut.data.id, quantity: 0.25 }],
  } })).response.status, 403)
  const scrapSale = await request('/warehouse/scrap-sales', { method: 'POST', body: {
    amount: 15, notes: 'Isolated scrap-sale test', items: [{ offcutId: offcut.data.id, quantity: 0.25 }],
  } })
  assert.equal(scrapSale.response.status, 201, scrapSale.data.error)
  assert.equal(scrapSale.data.treasury_kind, 'income')
  assert.equal(scrapSale.data.treasury_category, 'إيرادات بيع خردة ومخلفات تشغيل')
  assert.equal(scrapSale.data.amount_cents, 1500)
  assert.equal((await request('/warehouse/offcuts')).data.find((item) => item.id === offcut.data.id).quantity, 0.25)
  const scrapSaleRemainder = await request('/warehouse/scrap-sales', { method: 'POST', body: {
    amount: 5, items: [{ offcutId: offcut.data.id, quantity: 0.25 }],
  } })
  assert.equal(scrapSaleRemainder.response.status, 201, scrapSaleRemainder.data.error)
  assert.equal((await request('/warehouse/offcuts')).data.some((item) => item.id === offcut.data.id), false)

  const parallelMaterialRequests = await Promise.all([
    request('/materials', { method: 'POST', body: { name: 'Parallel material' } }),
    request('/materials', { method: 'POST', body: { name: 'Parallel material' } }),
  ])
  assert.deepEqual(parallelMaterialRequests.map((item) => item.response.status).sort(), [201, 409])

  const temporaryMaterial = await request('/materials', { method: 'POST', body: { name: 'Soft delete material' } })
  assert.equal((await request(`/materials/${temporaryMaterial.data.id}`, { method: 'DELETE' })).response.status, 200)
  assert.equal((await request('/materials')).data.some((item) => item.id === temporaryMaterial.data.id), false)
  const auditDb = new Database(path.join(tempRoot, 'test.sqlite'), { readonly: true, fileMustExist: true })
  try {
    assert.ok(auditDb.prepare('SELECT deleted_at FROM clients WHERE id=?').get(temporaryClient.data.id).deleted_at)
    const deletedMaterial = auditDb.prepare('SELECT active,deleted_at FROM materials WHERE id=?').get(temporaryMaterial.data.id)
    assert.equal(deletedMaterial.active, 0)
    assert.ok(deletedMaterial.deleted_at)
  } finally {
    auditDb.close()
  }

  assert.equal((await request('/workers')).response.status, 404)
  assert.equal(Object.hasOwn((await request('/bootstrap')).data, 'workers'), false)

  const invalidPrecisionPurchase = await request('/inventory/purchases', {
    method: 'POST', body: { supplier: 'Precision check', employeeId: maintenanceEmployee.data.id, items: [{ materialId: material.data.id, quantity: 1, unitCost: 50.001 }] },
  })
  assert.equal(invalidPrecisionPurchase.response.status, 400)
  await new Promise((resolve) => setTimeout(resolve, 1050))
  const purchase = await request('/inventory/purchases', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'f77f7691-66e8-4e20-b311-d2127114d112' },
    body: { supplier: 'Test supplier', employeeId: maintenanceEmployee.data.id, items: [{ materialId: material.data.id, quantity: 3, unitCost: 50.25 }] },
  })
  assert.equal(purchase.response.status, 201)
  assert.equal(purchase.data.total, 150.75)
  assert.equal(purchase.data.paymentStatus, 'paid')
  assert.notEqual(purchase.data.items[0].materialId, material.data.id)
  const purchaseBurst = await request('/inventory/purchases', {
    method: 'POST',
    headers: { 'Idempotency-Key': '0e49d37a-3c7e-4c7c-9b1b-506a34dc8e5c' },
    body: { supplier: 'Burst supplier', employeeId: maintenanceEmployee.data.id, items: [{ materialId: material.data.id, quantity: 1, unitCost: 50 }] },
  })
  assert.equal(purchaseBurst.response.status, 429)
  const purchaseReplay = await request('/inventory/purchases', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'f77f7691-66e8-4e20-b311-d2127114d112' },
    body: { supplier: 'Test supplier', employeeId: maintenanceEmployee.data.id, items: [{ materialId: material.data.id, quantity: 3, unitCost: 50.25 }] },
  })
  assert.equal(purchaseReplay.response.status, 201)
  assert.equal(purchaseReplay.response.headers.get('idempotency-replayed'), 'true')
  assert.equal(purchaseReplay.data.id, purchase.data.id)
  const keyConflict = await request('/inventory/purchases', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'f77f7691-66e8-4e20-b311-d2127114d112' },
    body: { supplier: 'Different supplier', employeeId: maintenanceEmployee.data.id, items: [{ materialId: material.data.id, quantity: 4, unitCost: 50 }] },
  })
  assert.equal(keyConflict.response.status, 409)

  const issue = await request('/inventory/issue', {
    method: 'POST',
    body: { materialId: purchase.data.items[0].materialId, quantity: 1.75, classification: 'general', reference: 'TEST-ORDER' },
  })
  assert.equal(issue.response.status, 200)
  assert.deepEqual({ ok: issue.data.ok, stock: issue.data.stock, subStock: issue.data.subStock,
    mainDeducted: issue.data.mainDeducted, subUsed: issue.data.subUsed, offcutCreated: issue.data.offcutCreated },
  { ok: true, stock: 1, subStock: 0.25, mainDeducted: 2, subUsed: 0, offcutCreated: 0.25 })
  assert.equal(issue.data.classification, 'general')
  assert.equal(issue.data.grossCostCents, 10050)
  assert.equal(issue.data.offcutCostCents, 1256)
  assert.equal(issue.data.cogsCents, 8794)
  assert.equal((await request('/inventory/issue', {
    method: 'POST', body: { materialId: purchase.data.items[0].materialId, quantity: 0.1 },
  })).response.status, 400)
  assert.equal((await request('/inventory/issue', {
    method: 'POST', body: { materialId: material.data.id, quantity: 1, warehouse: 'unknown' },
  })).response.status, 400)

  const invalidPrecisionSale = await request('/inventory/sales', {
    method: 'POST', body: { clientId: client.data.id, total: 500.001 },
  })
  assert.equal(invalidPrecisionSale.response.status, 400)
  await new Promise((resolve) => setTimeout(resolve, 1050))
  const sale = await request('/inventory/sales', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'e5de1068-171f-4a91-83d8-8ee84ae806d9' },
    body: { clientId: client.data.id, total: 500, notes: 'Test sale' },
  })
  assert.equal(sale.response.status, 201)
  const salesBurst = await request('/inventory/sales', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'a107c02b-8c35-49a0-a79a-7e91c0d53b68' },
    body: { clientId: client.data.id, total: 35, notes: 'Rate limit check' },
  })
  assert.equal(salesBurst.response.status, 429)
  const saleReplay = await request('/inventory/sales', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'e5de1068-171f-4a91-83d8-8ee84ae806d9' },
    body: { clientId: client.data.id, total: 500, notes: 'Test sale' },
  })
  assert.equal(saleReplay.data.id, sale.data.id)
  assert.equal(saleReplay.response.headers.get('idempotency-replayed'), 'true')

  const expense = await request('/treasury/entries', {
    method: 'POST',
    body: { kind: 'expense', amount: 30.25, category: 'Test expense', employeeId: maintenanceEmployee.data.id },
  })
  assert.equal(expense.response.status, 201)
  assert.equal((await request('/treasury/entries', {
    method: 'POST', body: { kind: 'expense', amount: 1.001, category: 'Precision check' },
  })).response.status, 400)
  assert.equal((await request('/treasury/entries', {
    method: 'POST', body: { kind: 'expense', amount: 1, category: 'Invalid employee', employeeId: 999999 },
  })).response.status, 400)

  const dashboard = await request('/finance/dashboard')
  assert.equal(dashboard.response.status, 200)
  assert.equal(dashboard.data.summary.income, 20)
  assert.equal(dashboard.data.summary.ownerFunding, 1000)
  assert.equal(dashboard.data.summary.expense, 181)
  assert.equal(dashboard.data.summary.cashBalance, 839)
  assert.equal(dashboard.data.summary.inventoryValue, 562.8125)
  assert.equal(dashboard.data.invoices.find((invoice) => invoice.id === sale.data.id).kind, 'sales')
  assert.equal(dashboard.data.invoices.find((invoice) => invoice.id === sale.data.id).payment_status, 'unpaid')
  assert.equal(dashboard.data.invoices.find((invoice) => invoice.id === purchase.data.id).payment_status, 'paid')
  assert.equal(dashboard.data.invoices.find((invoice) => invoice.id === purchase.data.id).employee_name, 'Test Maintenance')
  assert.ok(dashboard.data.entries.find((entry) => entry.id === expense.data.id && entry.employee_name === 'Test Maintenance'))
  const partialReceipt = await request(`/treasury/invoices/${sale.data.id}/payments`, { method: 'POST', body: { amount: 200 } })
  assert.equal(partialReceipt.response.status, 201)
  assert.deepEqual({ paid: partialReceipt.data.paidTotal, remaining: partialReceipt.data.remaining, status: partialReceipt.data.paymentStatus },
    { paid: 200, remaining: 300, status: 'partial' })
  const clientStatement = await request(`/clients/${client.data.id}/statement`)
  assert.equal(clientStatement.response.status, 200)
  assert.equal(clientStatement.data.total_billed, 500)
  assert.equal(clientStatement.data.total_paid, 200)
  assert.equal(clientStatement.data.outstanding_balance, 300)
  assert.equal(clientStatement.data.overdue_60_days, false)
  assert.equal((await request(`/clients/${client.data.id}/statement`, { authCookie: operationsCookie })).response.status, 403)
  assert.equal((await request(`/treasury/invoices/${sale.data.id}/payments`, {
    method: 'POST', body: { amount: 1.001 },
  })).response.status, 400)
  const partialPayment = await request(`/treasury/invoices/${purchase.data.id}/payments`, { method: 'POST', body: { amount: 50 } })
  assert.equal(partialPayment.response.status, 409)
  const overpayment = await request(`/treasury/invoices/${sale.data.id}/payments`, { method: 'POST', body: { amount: 301 } })
  assert.equal(overpayment.response.status, 409)
  await request(`/treasury/invoices/${sale.data.id}/payments`, { method: 'POST', body: { amount: 300 } })
  assert.equal((await request(`/treasury/invoices/${purchase.data.id}/payments`, { method: 'POST', body: { amount: 100.75 } })).response.status, 409)

  const orderKey = '5a2a5b7c-9a8f-4a57-a15a-1945de1a458a'
  const missingOrderClient = await request('/orders', { method: 'POST', body: {} })
  assert.equal(missingOrderClient.response.status, 400)
  assert.equal(missingOrderClient.data.error, 'يرجى اختيار العميل أولاً لحفظ البيانات في مسارها الصحيح')
  await new Promise((resolve) => setTimeout(resolve, 1050))
  const invalidPrecisionOrder = await request('/orders', {
    method: 'POST', body: { clientId: client.data.id, materialCost: 1.001, sellingPrice: 2 },
  })
  assert.equal(invalidPrecisionOrder.response.status, 400)
  await new Promise((resolve) => setTimeout(resolve, 1050))
  const orderCreate = await request('/orders', {
    method: 'POST', headers: { 'Idempotency-Key': orderKey },
    body: {
      clientId: client.data.id, type: 'operation', notes: 'Operation form submission', employeeIds: [],
      materialCost: 0, operatingCost: 0, sellingPrice: 0, totalCost: 0,
    },
  })
  assert.equal(orderCreate.response.status, 201)
  assert.equal(orderCreate.data.folderPath, `Clients/${client.data.name}/Operation/${orderCreate.data.code}`)
  const linkedIssue = await request('/inventory/issue', {
    method: 'POST', body: { materialId: purchase.data.items[0].materialId, quantity: 0.5,
      warehouse: 'auto', classification: 'order', orderId: orderCreate.data.id },
  })
  assert.equal(linkedIssue.response.status, 200, linkedIssue.data.error)
  assert.equal(linkedIssue.data.cogsCents, 2512)
  assert.equal(linkedIssue.data.orderId, orderCreate.data.id)
  assert.equal((await request(`/orders/${orderCreate.data.id}`)).data.actualMaterialCogsCents, 2512)
  const orderIssueRow = (await request(`/orders/${orderCreate.data.id}`)).data.inventoryIssues[0]
  assert.equal(orderIssueRow.cogs_cents, 2512)
  assert.equal(orderIssueRow.journal_status, 'posted')
  const accountingSetupForCogs = await request('/accounting/setup')
  const manufacturingAccountIds = {}
  for (const key of ['inventory', 'work_order_wip', 'work_order_cogs', 'inventory_consumption']) {
    const account = accountingSetupForCogs.data.accounts.find((item) => item.system_key === key)
    const mapping = accountingSetupForCogs.data.mappings.find((item) => item.mapping_key === key)
    assert.ok(account, `missing standard account ${key}`)
    assert.deepEqual({ account_id: mapping.account_id, approved: mapping.approved }, { account_id: account.id, approved: 1 })
    manufacturingAccountIds[key] = account.id
  }
  const issueJournal = (await request('/accounting/journal?sourceType=inventory_issue')).data
    .find((entry) => entry.source_key === `inventory-issue:${orderIssueRow.id}`)
  assert.equal(issueJournal.status, 'posted')
  assert.equal(issueJournal.source_href, `/orders/${orderCreate.data.id}`)
  const filteredIssueJournal = await request(`/accounting/journal?sourceType=inventory_issue&sourceId=${orderIssueRow.id}&accountId=${manufacturingAccountIds.inventory}`)
  assert.deepEqual(filteredIssueJournal.data.map((entry) => entry.id), [issueJournal.id])
  assert.ok(issueJournal.lines.some((line) => line.account_id === manufacturingAccountIds.work_order_wip
    && line.debit_cents === 2512))
  await new Promise((resolve) => setTimeout(resolve, 1050))
  const linkedSale = await request('/inventory/sales', {
    method: 'POST', body: { clientId: client.data.id, orderId: orderCreate.data.id, total: 100 },
  })
  assert.equal(linkedSale.response.status, 201, linkedSale.data.error)
  const cogsReport = (await request('/accounting/reports')).data
  assert.equal(cogsReport.workOrderRevenueCents, 10000)
  assert.equal(cogsReport.workOrderCogsCents, 2512)
  assert.equal(cogsReport.grossProfitCents, 7488)
  assert.equal(cogsReport.profitStatus, 'complete')
  assert.ok((await fs.promises.stat(path.join(tempRoot, 'storage', ...orderCreate.data.folderPath.split('/')))).isDirectory())
  const orderHistory = await request(`/orders/${orderCreate.data.id}/history`)
  assert.equal(orderHistory.response.status, 200)
  assert.ok(orderHistory.data.some((entry) => entry.action === 'create' && entry.entity === 'order'
    && entry.entity_id === String(orderCreate.data.id) && entry.actor_name === 'Test Admin'
    && entry.new_values?.code === orderCreate.data.code))
  assert.equal((await request(`/orders/${orderCreate.data.id}/history`, { authCookie: salesCookie })).response.status, 403)
  assert.equal((await request('/orders/999999/history')).response.status, 404)
  assert.equal(fs.existsSync(path.join(tempRoot, 'storage', 'Areas', orderCreate.data.code)), false)
  const createdOrderDb = new Database(path.join(tempRoot, 'test.sqlite'), { readonly: true })
  const createdOrderRow = createdOrderDb.prepare('SELECT area_path FROM orders WHERE id=?').get(orderCreate.data.id)
  assert.equal(createdOrderRow.area_path, orderCreate.data.folderPath)
  assert.equal(createdOrderDb.pragma('table_info(orders)').some((column) => column.name === 'title'), false)
  createdOrderDb.close()
  const orderReplay = await request('/orders', {
    method: 'POST', headers: { 'Idempotency-Key': orderKey },
    body: {
      clientId: client.data.id, type: 'operation', notes: 'Operation form submission', employeeIds: [],
      materialCost: 0, operatingCost: 0, sellingPrice: 0, totalCost: 0,
    },
  })
  assert.equal(orderReplay.data.id, orderCreate.data.id)
  assert.equal(orderReplay.response.headers.get('idempotency-replayed'), 'true')

  await new Promise((resolve) => setTimeout(resolve, 1050))
  const rateLimitedFirst = await request('/orders', { method: 'POST', body: { clientId: client.data.id } })
  const rateLimitedSecond = await request('/orders', { method: 'POST', body: { clientId: client.data.id } })
  assert.equal(rateLimitedFirst.response.status, 201)
  assert.equal(rateLimitedSecond.response.status, 429)
  await new Promise((resolve) => setTimeout(resolve, 1050))
  const rateLimitExpired = await request('/orders', { method: 'POST', body: { clientId: client.data.id } })
  assert.equal(rateLimitExpired.response.status, 201)
  await new Promise((resolve) => setTimeout(resolve, 1050))
  const maintenanceOrder = await request('/orders', {
    method: 'POST',
    body: {
      clientId: client.data.id,
      type: 'maintenance',
      notes: 'Maintenance form submission',
      employeeIds: [maintenanceEmployee.data.id],
    },
  })
  assert.equal(maintenanceOrder.response.status, 201)
  assert.equal(maintenanceOrder.data.folderPath, `Clients/${client.data.name}/Maintenance/${maintenanceOrder.data.code}`)
  assert.equal(maintenanceOrder.data.assignedEmployeeId, maintenanceEmployee.data.id)
  assert.deepEqual(maintenanceOrder.data.employeeIds, [maintenanceEmployee.data.id])
  const maintenanceDb = new Database(path.join(tempRoot, 'test.sqlite'), { readonly: true })
  assert.deepEqual(maintenanceDb.prepare('SELECT total_cost,material_cost,operating_cost,selling_price FROM orders WHERE id=?').get(maintenanceOrder.data.id), {
    total_cost: null, material_cost: null, operating_cost: null, selling_price: null,
  })
  maintenanceDb.close()
  const maintenanceDetails = await request(`/orders/${maintenanceOrder.data.id}`)
  assert.equal(maintenanceDetails.data.assignedEmployeeId, maintenanceEmployee.data.id)
  assert.equal(maintenanceDetails.data.assignedEmployeeName, 'Test Maintenance')
  assert.equal(maintenanceDetails.data.totalCost, null)
  assert.equal(maintenanceDetails.data.materialCost, null)
  assert.equal(maintenanceDetails.data.operatingCost, null)
  assert.equal(maintenanceDetails.data.sellingPrice, null)
  assert.equal(maintenanceDetails.data.profit, null)
  await new Promise((resolve) => setTimeout(resolve, 1100))
  const additionalDepartmentAssignment = await request('/orders', {
    method: 'POST', body: { clientId: client.data.id, type: 'maintenance', assignedEmployeeId: loginEmployee.data.id },
  })
  assert.equal(additionalDepartmentAssignment.response.status, 201)
  assert.deepEqual(additionalDepartmentAssignment.data.employeeIds, [loginEmployee.data.id])
  const bootstrapWithEmployees = await request('/bootstrap')
  assert.ok(bootstrapWithEmployees.data.employees.some((employee) => employee.id === maintenanceEmployee.data.id && employee.department === 'Maintenance'))

  const movements = await request('/inventory/movements')
  assert.ok(movements.data.some((movement) => movement.warehouse === 'sub' && movement.quantity === 0.25))
  assert.ok(movements.data.some((movement) => movement.issue_classification === 'general'))
  assert.ok(movements.data.some((movement) => movement.order_code === orderCreate.data.code))

  fs.mkdirSync(path.join(tempRoot, 'storage', 'Areas', 'manual-import'), { recursive: true })
  const areas = await request('/areas')
  assert.equal(areas.response.status, 200)
  assert.ok(areas.data.some((area) => area.name === 'manual-import' && area.addedAt))
  assert.ok(areas.data.every((area) => area.name !== '.incoming'))

  const thumbnailSource = path.join(tempRoot, 'storage', 'Areas', 'manual-import', 'thumbnail-source.png')
  await sharp({ create: { width: 900, height: 600, channels: 3, background: '#3b7392' } }).png().toFile(thumbnailSource)
  const sourceBytes = await fs.promises.readFile(thumbnailSource)
  const sourceHash = crypto.createHash('sha256').update(sourceBytes).digest('hex')
  const thumbnail = await request(`/files/thumbnail?path=${encodeURIComponent('Areas/manual-import/thumbnail-source.png')}`)
  assert.equal(thumbnail.response.status, 200)
  assert.match(thumbnail.response.headers.get('content-type'), /image\/webp/)
  assert.ok(thumbnail.data.byteLength <= 20 * 1024)
  assert.equal((await sharp(Buffer.from(thumbnail.data)).metadata()).width, 200)
  assert.equal(crypto.createHash('sha256').update(await fs.promises.readFile(thumbnailSource)).digest('hex'), sourceHash)

  const machine = await request('/machines', { method: 'POST', body: { code: 'TEST-MACHINE', nameAr: 'Test machine' } })
  const machineList = await request('/machines')
  assert.equal(machineList.response.status, 200)
  assert.equal(machineList.data.find((item) => item.id === machine.data.id).code, 'TEST-MACHINE')
  const machineImportForm = new FormData()
  machineImportForm.append('deactivateMissing', 'true')
  machineImportForm.append('file', new Blob([
    'كود الماكينة,الاسم بالعربي,Regions\nTEST-MACHINE,Updated machine,North\nNEW-MACHINE,New machine,South\n',
  ], { type: 'text/csv' }), 'machines.csv')
  const machineImportConflict = await request('/machines/import', { method: 'POST', form: machineImportForm })
  assert.equal(machineImportConflict.response.status, 409, JSON.stringify(machineImportConflict.data))
  assert.equal(machineImportConflict.data.hasConflicts, true)
  assert.equal(machineImportConflict.data.conflictCount, 1)
  const machineBeforeOverwrite = await request('/machines')
  assert.equal(machineBeforeOverwrite.data.find((item) => item.code === 'TEST-MACHINE').nameAr, 'Test machine')
  const machineImport = await request('/machines/import?overwrite=true', { method: 'POST', form: machineImportForm })
  assert.equal(machineImport.response.status, 200)
  assert.deepEqual(machineImport.data, { added: 1, updated: 1, deactivated: 0, skipped: 0 })
  const excelArchivePath = path.join(tempRoot, 'storage', 'Uploads', 'Excel')
  const archivedMachineImports = await fs.promises.readdir(excelArchivePath)
  const archivedMachineImport = archivedMachineImports.find((name) => /^Machines_Import_machines_\d+_[0-9a-f-]{36}\.csv$/i.test(name))
  assert.ok(archivedMachineImport)
  assert.ok((await fs.promises.stat(path.join(excelArchivePath, archivedMachineImport))).size > 0)
  const archiveListing = await request('/storage/files?path=Uploads/Excel')
  assert.equal(archiveListing.response.status, 200)
  assert.ok(archiveListing.data.some((entry) => entry.name === archivedMachineImport && entry.type === 'file'))
  const machineListAfterUpsert = await request('/bootstrap')
  assert.equal(machineListAfterUpsert.data.machines.find((row) => row.code === 'TEST-MACHINE').id, machine.data.id)
  assert.equal(machineListAfterUpsert.data.machines.find((row) => row.code === 'TEST-MACHINE').area, 'North')
  assert.equal('region' in machineListAfterUpsert.data.machines.find((row) => row.code === 'TEST-MACHINE'), false)
  assert.equal('governorate' in machineListAfterUpsert.data.machines.find((row) => row.code === 'TEST-MACHINE'), false)
  const areasForImportedMachine = await request('/machines/areas')
  assert.ok(areasForImportedMachine.data.some((area) => area.name === 'North'))
  await request('/machines', { method: 'POST', body: { code: 'SKIP-MACHINE', nameAr: 'Keep existing' } })
  const skipMachineForm = new FormData()
  skipMachineForm.append('file', new Blob([
    'Machine Code,Arabic Name,English Name,Region\nSKIP-MACHINE,Do not overwrite,Old EN,Old Area\nSKIP-NEW,New row,New EN,North Region\n',
  ], { type: 'text/csv' }), 'skip-machines.csv')
  const skippedExistingImport = await request('/machines/import?skipExisting=true', { method: 'POST', form: skipMachineForm })
  assert.equal(skippedExistingImport.response.status, 200)
  assert.deepEqual(skippedExistingImport.data, { added: 1, updated: 0, deactivated: 0, skipped: 1 })
  const skippedExistingMachine = await request('/machines')
  assert.equal(skippedExistingMachine.data.find((item) => item.code === 'SKIP-MACHINE').nameAr, 'Keep existing')
  const importedSkipMachine = skippedExistingMachine.data.find((item) => item.code === 'SKIP-NEW')
  assert.equal(importedSkipMachine.nameAr, 'New row')
  assert.equal(importedSkipMachine.nameEn, 'New EN')
  assert.equal(importedSkipMachine.area, 'North Region')

  const restoreWithSkipMachine = await request('/machines', {
    method: 'POST', body: { code: 'RESTORE-WITH-SKIP', nameAr: 'Old Arabic', nameEn: 'Old English', area: 'Old Area' },
  })
  assert.equal((await request(`/machines/${restoreWithSkipMachine.data.id}`, { method: 'DELETE' })).response.status, 200)
  await new Promise((resolve) => setTimeout(resolve, 1050))
  const restoreWithSkipForm = new FormData()
  restoreWithSkipForm.append('file', new Blob([
    'Machine Code,Arabic Name,English Name,Region\nSKIP-MACHINE,Must stay unchanged,Ignored EN,Ignored Area\nRESTORE-WITH-SKIP,Restored Arabic,Restored English,Restored Area\nSKIP-NEW-RESTORE,New Arabic,New English,New Area\n',
  ], { type: 'text/csv' }), 'restore-with-skip.csv')
  const restoreWithSkipImport = await request('/machines/import?skipExisting=true', { method: 'POST', form: restoreWithSkipForm })
  assert.equal(restoreWithSkipImport.response.status, 200, JSON.stringify(restoreWithSkipImport.data))
  assert.deepEqual(restoreWithSkipImport.data, { added: 1, updated: 1, deactivated: 0, skipped: 1 })
  const machinesAfterSkipRestore = await request('/machines')
  const restoredWithSkip = machinesAfterSkipRestore.data.find((row) => row.code === 'RESTORE-WITH-SKIP')
  assert.equal(restoredWithSkip.id, restoreWithSkipMachine.data.id)
  assert.equal(restoredWithSkip.nameAr, 'Restored Arabic')
  assert.equal(restoredWithSkip.nameEn, 'Restored English')
  assert.equal(restoredWithSkip.area, 'Restored Area')
  assert.equal(machinesAfterSkipRestore.data.find((row) => row.code === 'SKIP-MACHINE').nameAr, 'Keep existing')
  const restoreWithSkipDb = new Database(path.join(tempRoot, 'test.sqlite'), { readonly: true })
  assert.equal(restoreWithSkipDb.prepare('SELECT deleted_at FROM machines WHERE id=?').get(restoreWithSkipMachine.data.id).deleted_at, null)
  restoreWithSkipDb.close()

  const restoreWithoutSkipMachine = await request('/machines', {
    method: 'POST', body: { code: 'RESTORE-WITHOUT-SKIP', nameAr: 'Old Arabic' },
  })
  assert.equal((await request(`/machines/${restoreWithoutSkipMachine.data.id}`, { method: 'DELETE' })).response.status, 200)
  await new Promise((resolve) => setTimeout(resolve, 1050))
  const restoreWithoutSkipForm = new FormData()
  restoreWithoutSkipForm.append('file', new Blob([
    'Machine Code,Arabic Name,English Name,Region\nRESTORE-WITHOUT-SKIP,Fresh Arabic,Fresh English,Fresh Area\n',
  ], { type: 'text/csv' }), 'restore-without-skip.csv')
  const restoreWithoutSkipImport = await request('/machines/import', { method: 'POST', form: restoreWithoutSkipForm })
  assert.equal(restoreWithoutSkipImport.response.status, 200, JSON.stringify(restoreWithoutSkipImport.data))
  assert.deepEqual(restoreWithoutSkipImport.data, { added: 0, updated: 1, deactivated: 0, skipped: 0 })
  const machinesAfterDefaultRestore = await request('/machines')
  const restoredWithoutSkip = machinesAfterDefaultRestore.data.find((row) => row.code === 'RESTORE-WITHOUT-SKIP')
  assert.equal(restoredWithoutSkip.id, restoreWithoutSkipMachine.data.id)
  assert.equal(restoredWithoutSkip.nameAr, 'Fresh Arabic')
  assert.equal(restoredWithoutSkip.nameEn, 'Fresh English')
  assert.equal(restoredWithoutSkip.area, 'Fresh Area')

  const missingMachineForm = new FormData()
  missingMachineForm.append('deactivateMissing', 'true')
  missingMachineForm.append('file', new Blob(['كود الماكينة,الاسم بالعربي\nTEST-MACHINE,Updated machine\n'], { type: 'text/csv' }), 'machines.csv')
  await new Promise((resolve) => setTimeout(resolve, 1050))
  const missingMachines = await request('/machines/import?overwrite=true', { method: 'POST', form: missingMachineForm })
  assert.equal(missingMachines.data.deactivated, 6)
  const order = orderCreate.data
  assert.deepEqual((await request(`/orders/${order.id}/processing-status`)).data, {
    orderId: order.id, status: 'idle', percentage: 0, processedFiles: 0, totalFiles: 0,
  })
  const arabicMachine = await request('/machines', {
    method: 'POST', body: { code: 'ARABIC-TEST', nameAr: 'خليج نعمة', area: 'شرم الشيخ' },
  })
  assert.equal(arabicMachine.response.status, 201)
  const machineAreas = await request('/machine-areas')
  assert.ok(machineAreas.data.some((area) => area.id === 'شرم الشيخ' && area.name === 'شرم الشيخ'))
  const machineAreasAlias = await request('/machines/areas')
  assert.equal(machineAreasAlias.response.status, 200)
  assert.ok(machineAreasAlias.data.some((area) => area.id === 'شرم الشيخ' && area.name === 'شرم الشيخ'))
  const machinesByArea = await request('/machines/by-areas?areas=' + encodeURIComponent('شرم الشيخ'))
  assert.equal(machinesByArea.response.status, 200)
  assert.ok(machinesByArea.data.some((machine) => machine.id === arabicMachine.data.id && machine.nameAr === 'خليج نعمة'))
  assert.equal((await request('/machines/by-areas')).response.status, 400)
  const emptyAreaOrder = await request('/orders', { method: 'POST', body: { clientId: client.data.id } })
  const emptyAreaCard = await request(`/orders/${emptyAreaOrder.data.id}/cards`, {
    method: 'POST', body: { machineId: arabicMachine.data.id },
  })
  assert.equal(emptyAreaCard.response.status, 201)
  const emptyAreaOrderDetail = await request(`/orders/${emptyAreaOrder.data.id}`)
  assert.deepEqual(emptyAreaOrderDetail.data.cards[0].beforePhotos, [])
  assert.deepEqual(emptyAreaOrderDetail.data.cards[0].afterPhotos, [])
  assert.equal(emptyAreaOrderDetail.data.machineCount, 1)
  assert.equal((await request(`/orders/${emptyAreaOrder.data.id}`, { method: 'DELETE' })).response.status, 200)

  const directUploadForm = new FormData()
  directUploadForm.append('files', new Blob([sourceBytes], { type: 'image/png' }), 'direct-upload.png')
  directUploadForm.append('paths', 'server-side-picker/خليج نعمة/direct-upload.png')
  const directUpload = await request(`/orders/${order.id}/area`, {
    method: 'POST', form: directUploadForm, headers: { 'Idempotency-Key': 'aa8f3e7b-7fa2-4ef6-a005-8a2ab55528fe' },
  })
  assert.equal(directUpload.response.status, 200, JSON.stringify(directUpload.data))
  const directUploadDetail = await request(`/orders/${order.id}`)
  const directUploadCard = directUploadDetail.data.cards.find((card) => card.machineId === arabicMachine.data.id)
  assert.ok(directUploadCard?.beforePhotos[0].startsWith(`${order.folderPath}/ARABIC-TEST/`))
  assert.ok(fs.existsSync(path.join(tempRoot, 'storage', ...directUploadCard.beforePhotos[0].split('/'))))
  assert.equal(fs.existsSync(path.join(tempRoot, 'storage', 'Areas', order.code)), false)
  await new Promise((resolve) => setTimeout(resolve, 1050))
  const oversizedUploadForm = new FormData()
  oversizedUploadForm.append('files', new Blob([Buffer.alloc(1024 * 1024 + 1024)], { type: 'image/jpeg' }), 'too-large-request.jpg')
  oversizedUploadForm.append('paths', 'request-limit/too-large-request.jpg')
  const oversizedUpload = await request(`/orders/${order.id}/area`, { method: 'POST', form: oversizedUploadForm })
  assert.equal(oversizedUpload.response.status, 413, JSON.stringify(oversizedUpload.data))
  assert.match(oversizedUpload.data.error, /إجمالي طلب رفع الصور/)
  assert.deepEqual(await fs.promises.readdir(path.join(tempRoot, 'storage', 'Areas', '.incoming')), [])

  const serverPickerFolder = 'شرم الشيخ'
  const serverPickerImage = path.join(tempRoot, 'storage', 'Areas', serverPickerFolder, 'unknown-branch', 'server-photo.png')
  await fs.promises.mkdir(path.dirname(serverPickerImage), { recursive: true })
  await fs.promises.copyFile(thumbnailSource, serverPickerImage)
  const serverPickerSourceHash = crypto.createHash('sha256').update(await fs.promises.readFile(serverPickerImage)).digest('hex')
  const corruptServerPickerImage = path.join(path.dirname(serverPickerImage), 'corrupt-photo.jpg')
  await fs.promises.writeFile(corruptServerPickerImage, 'not a decodable image')
  const arabicMachineImage = path.join(tempRoot, 'storage', 'Areas', serverPickerFolder, 'خليج نعمة', 'arabic-photo.png')
  await fs.promises.mkdir(path.dirname(arabicMachineImage), { recursive: true })
  await fs.promises.copyFile(thumbnailSource, arabicMachineImage)
  const nestedExplorerFolder = '2026/شرم الشيخ/خليج نعمة'
  const nestedExplorerImage = path.join(tempRoot, 'storage', 'Areas', ...nestedExplorerFolder.split('/'), 'nested-photo.png')
  await fs.promises.mkdir(path.dirname(nestedExplorerImage), { recursive: true })
  await fs.promises.copyFile(thumbnailSource, nestedExplorerImage)
  await fs.promises.writeFile(path.join(tempRoot, 'storage', 'Areas', 'not-a-folder.txt'), 'ignore this file')
  await fs.promises.writeFile(path.join(tempRoot, 'storage', 'Areas', '.hidden-area'), 'ignore hidden files')
  const areaFolders = await request('/areas-folders')
  assert.equal(areaFolders.response.status, 200)
  assert.ok(areaFolders.data.includes(serverPickerFolder))
  assert.equal(areaFolders.data.includes('not-a-folder.txt'), false)
  assert.equal(areaFolders.data.includes('.incoming'), false)
  const explorerRoot = await request('/storage/explorer')
  assert.equal(explorerRoot.response.status, 200)
  assert.ok(explorerRoot.data.some((entry) => entry.name === '2026' && entry.path === '2026'))
  assert.equal(explorerRoot.data.some((entry) => entry.name.startsWith('.')), false)
  const explorerYear = await request('/storage/explorer?path=2026')
  assert.ok(explorerYear.data.some((entry) => entry.name === 'شرم الشيخ' && entry.path === '2026/شرم الشيخ'))
  const explorerRegion = await request('/storage/explorer?path=2026/%D8%B4%D8%B1%D9%85%20%D8%A7%D9%84%D8%B4%D9%8A%D8%AE')
  assert.ok(explorerRegion.data.some((entry) => entry.name === 'خليج نعمة' && entry.path === nestedExplorerFolder))
  assert.equal((await request('/storage/explorer?path=../')).response.status, 400)
  assert.equal((await request('/storage/explorer?path=.incoming')).response.status, 400)

  const storageTestFolder = path.join(tempRoot, 'storage', 'Areas', 'storage-manager-test', 'nested')
  await fs.promises.mkdir(storageTestFolder, { recursive: true })
  await fs.promises.writeFile(path.join(storageTestFolder, 'stored-file.txt'), 'storage manager test')
  const storageRootListing = await request('/storage/files', { authCookie: operationsCookie })
  assert.equal(storageRootListing.response.status, 200)
  assert.ok(storageRootListing.data.some((entry) => entry.name === 'Areas' && entry.type === 'folder'))
  assert.ok(storageRootListing.data.some((entry) => entry.name === 'Uploads' && entry.type === 'folder'))
  const storageAreaListing = await request('/storage/files?path=Areas/storage-manager-test')
  assert.equal(storageAreaListing.response.status, 200)
  assert.ok(storageAreaListing.data.some((entry) => entry.name === 'nested' && entry.type === 'folder'))
  const storageNestedListing = await request('/storage/files?path=Areas/storage-manager-test/nested')
  const storedFile = storageNestedListing.data.find((entry) => entry.name === 'stored-file.txt')
  assert.ok(storedFile)
  assert.equal(storedFile.type, 'file')
  assert.equal(storedFile.size, Buffer.byteLength('storage manager test'))
  assert.ok(storedFile.createdAt)
  assert.equal((await request('/storage/files?path=../')).response.status, 400)
  const rejectedStorageTraversal = await request('/storage/files', {
    method: 'DELETE', body: { path: '../outside-storage.txt' },
  })
  assert.equal(rejectedStorageTraversal.response.status, 400)
  const removedStorageFolder = await request('/storage/files', {
    method: 'DELETE', body: { path: 'Areas/storage-manager-test' },
  })
  assert.equal(removedStorageFolder.response.status, 200)
  const missingStorageFolder = await request('/storage/files?path=Areas/storage-manager-test')
  assert.equal(missingStorageFolder.response.status, 200)
  assert.deepEqual(missingStorageFolder.data, [])
  assert.equal((await request('/storage/files?path=Areas/.incoming')).response.status, 400)

  const importKey = '668b8d6a-827e-4c04-a731-2fb91e6037d4'
  const importRequest = {
    method: 'POST',
    headers: { 'Idempotency-Key': importKey },
    body: { folderName: serverPickerFolder, area_id: 'شرم الشيخ' },
  }
  const importedServerFolderStart = await request(`/orders/${order.id}/area/import-folder`, importRequest)
  assert.equal(importedServerFolderStart.response.status, 202)
  assert.equal(importedServerFolderStart.data.status, 'processing')
  assert.equal(importedServerFolderStart.data.percentage, 0)
  const importedServerFolderStatus = await waitForProcessingJob(order.id)
  assert.equal(importedServerFolderStatus.status, 'completed')
  assert.equal(importedServerFolderStatus.percentage, 100)
  const importedServerFolder = { response: importedServerFolderStart.response, data: importedServerFolderStatus.result }
  assert.equal(importedServerFolder.data.received, 2)
  assert.equal(importedServerFolder.data.skipped, 1)
  assert.equal(importedServerFolder.data.sourceFolder, serverPickerFolder)
  assert.equal(importedServerFolder.data.areaId, 'شرم الشيخ')
  assert.equal(fs.existsSync(serverPickerImage), true)
  assert.equal(crypto.createHash('sha256').update(await fs.promises.readFile(serverPickerImage)).digest('hex'), serverPickerSourceHash)
  assert.equal(fs.existsSync(corruptServerPickerImage), true)
  await new Promise((resolve) => setTimeout(resolve, 1050))
  const nestedImportStart = await request('/process-area', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'fc4b14bd-8a8d-4f86-9c60-5c1599f85864' },
    body: { orderId: order.id, folderPath: nestedExplorerFolder, areas: ['شرم الشيخ', 'القاهرة'] },
  })
  assert.equal(nestedImportStart.response.status, 202)
  const nestedImportStatus = await waitForProcessingJob(order.id)
  assert.equal(nestedImportStatus.status, 'completed')
  const nestedImport = { response: nestedImportStart.response, data: nestedImportStatus.result }
  assert.equal(nestedImport.data.sourceFolder, nestedExplorerFolder)
  assert.equal(nestedImport.data.received, 1)
  assert.deepEqual(nestedImport.data.areas, ['شرم الشيخ', 'القاهرة'])
  const importedOutputDirectory = path.join(tempRoot, 'storage', ...order.folderPath.split('/'), 'unknown-branch')
  const importedOutputFiles = await fs.promises.readdir(importedOutputDirectory)
  assert.equal(importedOutputFiles.length, 1)
  assert.match(importedOutputFiles[0], /\.jpg$/)
  assert.equal((await sharp(path.join(importedOutputDirectory, importedOutputFiles[0])).metadata()).format, 'jpeg')
  const importedArabicMachine = await request(`/orders/${order.id}`)
  assert.ok(importedArabicMachine.data.cards.some((card) => card.machineId === arabicMachine.data.id && card.beforePhotos.length >= 1))
  const importedServerFolderReplay = await request(`/orders/${order.id}/area/import-folder`, importRequest)
  assert.equal(importedServerFolderReplay.response.status, 200)
  assert.equal(importedServerFolderReplay.response.headers.get('idempotency-replayed'), 'true')
  assert.deepEqual(importedServerFolderReplay.data, importedServerFolder.data)
  const conflictingFolderReplay = await request(`/orders/${order.id}/area/import-folder`, {
    ...importRequest,
    body: { folderName: 'manual-import', area_id: 'شرم الشيخ' },
  })
  assert.equal(conflictingFolderReplay.response.status, 409)
  const orderAfterServerFolderImport = await request(`/orders/${order.id}`)
  const unknownFolder = orderAfterServerFolderImport.data.unrecognizedFolders.find((folder) => folder.name === 'unknown-branch' && folder.imageCount === 1)
  assert.ok(unknownFolder)
  const bindingMachine = await request('/machines', {
    method: 'POST', body: { code: 'BIND-FOLDER-TEST', nameAr: 'ماكينة الربط التجريبية', area: 'شرم الشيخ' },
  })
  const folderBinding = await request('/storage/bind-folder', {
    method: 'POST', body: {
      orderId: order.id, originalFolderName: unknownFolder.name,
      originalFolderPath: unknownFolder.originalFolderPath,
      machineCode: bindingMachine.data.code,
    },
  })
  assert.equal(folderBinding.response.status, 200)
  const standardizedBindingFolder = 'BIND-FOLDER-TEST - ماكينة الربط التجريبية'
  assert.equal(folderBinding.data.originalFolderPath, `Areas/${serverPickerFolder}/unknown-branch`)
  assert.equal(folderBinding.data.updatedFolderPath, `Areas/${serverPickerFolder}/${standardizedBindingFolder}`)
  assert.equal(path.dirname(folderBinding.data.originalFolderPath), path.dirname(folderBinding.data.updatedFolderPath))
  assert.deepEqual(folderBinding.data.machine, {
    id: bindingMachine.data.id, code: 'BIND-FOLDER-TEST', nameAr: 'ماكينة الربط التجريبية', area: 'شرم الشيخ',
  })
  assert.equal(folderBinding.data.originalFolderName, 'unknown-branch')
  const renamedSourceFolder = path.join(tempRoot, 'storage', ...folderBinding.data.updatedFolderPath.split('/'))
  assert.ok(fs.existsSync(renamedSourceFolder))
  assert.ok(fs.existsSync(importedOutputDirectory), 'binding must not move or remove the order-side copy')
  const retainedOriginalImage = path.join(renamedSourceFolder, 'server-photo.png')
  assert.equal(fs.existsSync(retainedOriginalImage), true)
  assert.equal(crypto.createHash('sha256').update(await fs.promises.readFile(retainedOriginalImage)).digest('hex'), serverPickerSourceHash)
  assert.equal(fs.existsSync(path.join(tempRoot, 'storage', 'Areas', serverPickerFolder, 'unknown-branch')), false)
  const orderAfterFolderBinding = await request(`/orders/${order.id}`)
  assert.ok(!orderAfterFolderBinding.data.unrecognizedFolders.some((folder) => folder.id === unknownFolder.id))
  assert.ok(orderAfterFolderBinding.data.cards.some((card) => card.machineCode === bindingMachine.data.code))
  const futureScanFolder = 'future-machine-scan/' + standardizedBindingFolder
  const futureScanImage = path.join(tempRoot, 'storage', 'Areas', ...futureScanFolder.split('/'), 'scan-photo.png')
  await fs.promises.mkdir(path.dirname(futureScanImage), { recursive: true })
  await fs.promises.copyFile(thumbnailSource, futureScanImage)
  await new Promise((resolve) => setTimeout(resolve, 1050))
  const futureScanStart = await request('/process-area', {
    method: 'POST',
    headers: { 'Idempotency-Key': '93f2ce38-3708-41e4-9c7a-a65fd694f010' },
    body: { orderId: order.id, folderPath: futureScanFolder, areas: ['شرم الشيخ'] },
  })
  assert.equal(futureScanStart.response.status, 202)
  const futureScanStatus = await waitForProcessingJob(order.id)
  assert.equal(futureScanStatus.status, 'completed')
  const futureScan = { response: futureScanStart.response, data: futureScanStatus.result }
  assert.equal(futureScan.data.cards, 1)
  assert.ok((await request(`/orders/${order.id}`)).data.cards.some((card) => card.machineCode === bindingMachine.data.code))

  const maintenanceBindForm = new FormData()
  maintenanceBindForm.append('files', new Blob([sourceBytes], { type: 'image/png' }), 'maintenance-unknown.png')
  maintenanceBindForm.append('paths', 'maintenance-unknown/maintenance-unknown.png')
  const maintenanceUnknownUpload = await request(`/orders/${maintenanceOrder.data.id}/area`, {
    method: 'POST', form: maintenanceBindForm, headers: { 'Idempotency-Key': '66052db0-1570-4dd7-8061-48ea676530f4' },
  })
  assert.equal(maintenanceUnknownUpload.response.status, 200)
  const maintenanceUnknownFolder = (await request(`/orders/${maintenanceOrder.data.id}`)).data.unrecognizedFolders
    .find((folder) => folder.name === 'maintenance-unknown')
  assert.ok(maintenanceUnknownFolder)
  const maintenanceFolderBinding = await request('/storage/bind-folder', {
    method: 'POST', body: {
      orderId: maintenanceOrder.data.id, folderId: maintenanceUnknownFolder.id,
      machineCode: bindingMachine.data.code,
    },
  })
  assert.equal(maintenanceFolderBinding.response.status, 200)
  const maintenanceMachinePath = `Clients/${client.data.name}/Maintenance/${maintenanceOrder.data.code}/BIND-FOLDER-TEST - ماكينة الربط التجريبية`
  assert.equal(maintenanceFolderBinding.data.updatedFolderPath, maintenanceMachinePath)
  assert.ok(fs.existsSync(path.join(tempRoot, 'storage', ...maintenanceMachinePath.split('/'))))
  assert.equal(fs.existsSync(path.join(tempRoot, 'storage', ...maintenanceOrder.data.folderPath.split('/'), 'maintenance-unknown')), false)

  const incomingSourceFolder = path.join(tempRoot, 'storage', 'Areas', '.incoming', 'incoming-source')
  await fs.promises.mkdir(incomingSourceFolder, { recursive: true })
  const incomingSourceImage = path.join(incomingSourceFolder, 'incoming-photo.png')
  await fs.promises.writeFile(incomingSourceImage, sourceBytes)
  const incomingSourceHash = crypto.createHash('sha256').update(sourceBytes).digest('hex')
  await new Promise((resolve) => setTimeout(resolve, 1050))
  const incomingImportStart = await request('/process-area', {
    method: 'POST', headers: { 'Idempotency-Key': 'b56adf47-1f81-47f3-93f5-d06a34bd93ad' },
    body: { orderId: maintenanceOrder.data.id, folderPath: '.incoming/incoming-source', areas: ['شرم الشيخ'] },
  })
  assert.equal(incomingImportStart.response.status, 202, JSON.stringify(incomingImportStart.data))
  const incomingImportStatus = await waitForProcessingJob(maintenanceOrder.data.id)
  assert.equal(incomingImportStatus.status, 'completed', incomingImportStatus.error)
  const incomingImport = { response: incomingImportStart.response, data: incomingImportStatus.result }
  const incomingUnknownFolder = (await request(`/orders/${maintenanceOrder.data.id}`)).data.unrecognizedFolders
    .find((folder) => folder.name === 'incoming-source')
  assert.ok(incomingUnknownFolder)
  const incomingFolderBinding = await request('/storage/bind-folder', {
    method: 'POST', body: {
      orderId: maintenanceOrder.data.id, folderId: incomingUnknownFolder.id,
      machineCode: arabicMachine.data.code,
    },
  })
  assert.equal(incomingFolderBinding.response.status, 200)
  const incomingMachinePath = `Areas/.incoming/ARABIC-TEST - خليج نعمة`
  assert.equal(incomingFolderBinding.data.originalFolderPath, 'Areas/.incoming/incoming-source')
  assert.equal(incomingFolderBinding.data.updatedFolderPath, incomingMachinePath)
  assert.equal(path.dirname(incomingFolderBinding.data.originalFolderPath), path.dirname(incomingFolderBinding.data.updatedFolderPath))
  const retainedIncomingImage = path.join(tempRoot, 'storage', ...incomingMachinePath.split('/'), 'incoming-photo.png')
  assert.equal(crypto.createHash('sha256').update(await fs.promises.readFile(retainedIncomingImage)).digest('hex'), incomingSourceHash)
  assert.equal(fs.existsSync(incomingSourceFolder), false)

  const progressImageCount = 80
  const progressSourceFolder = path.join(tempRoot, 'storage', 'Areas', 'progress-test', 'unknown-progress')
  await fs.promises.mkdir(progressSourceFolder, { recursive: true })
  await Promise.all(Array.from({ length: progressImageCount }, (_, index) => fs.promises.copyFile(
    thumbnailSource, path.join(progressSourceFolder, `progress-${String(index + 1).padStart(3, '0')}.png`),
  )))
  await new Promise((resolve) => setTimeout(resolve, 1050))
  const progressStart = await request('/process-area', {
    method: 'POST', headers: { 'Idempotency-Key': '1d327745-616f-4b64-a468-6859a8bc4218' },
    body: { orderId: maintenanceOrder.data.id, folderPath: 'progress-test/unknown-progress', areas: ['شرم الشيخ'] },
  })
  assert.equal(progressStart.response.status, 202)
  const observedProcessingStatuses = []
  const progressStatus = await waitForProcessingJob(maintenanceOrder.data.id, 15000, (status) => observedProcessingStatuses.push(status))
  assert.equal(progressStatus.status, 'completed')
  assert.equal(progressStatus.percentage, 100)
  assert.equal(progressStatus.processedFiles, progressImageCount)
  assert.equal(progressStatus.totalFiles, progressImageCount)
  assert.ok(observedProcessingStatuses.some((status) => status.status === 'processing'
    && status.totalFiles === progressImageCount && status.processedFiles > 0
    && Number.isInteger(status.percentage) && status.percentage > 0 && status.percentage < 100))

  const eraseUnknownSource = path.join(tempRoot, 'storage', 'Areas', 'eradication-test', 'unknown-folder')
  await fs.promises.mkdir(eraseUnknownSource, { recursive: true })
  await fs.promises.copyFile(thumbnailSource, path.join(eraseUnknownSource, 'unknown-photo.png'))
  await new Promise((resolve) => setTimeout(resolve, 1050))
  const eraseUnknownImport = await request('/process-area', {
    method: 'POST', headers: { 'Idempotency-Key': 'bb4b58f4-3421-4a66-8b41-382c49388db9' },
    body: { orderId: maintenanceOrder.data.id, folderPath: 'eradication-test/unknown-folder', areas: ['شرم الشيخ'] },
  })
  assert.equal(eraseUnknownImport.response.status, 202)
  assert.equal((await waitForProcessingJob(maintenanceOrder.data.id)).status, 'completed')
  const erasableUnknownFolder = (await request(`/orders/${maintenanceOrder.data.id}`)).data.unrecognizedFolders
    .find((folder) => folder.name === 'unknown-folder')
  assert.ok(erasableUnknownFolder)
  const erasedUnknownFolder = await request('/machines/eradicate', {
    method: 'DELETE', body: {
      orderId: maintenanceOrder.data.id,
      folderId: erasableUnknownFolder.id,
      folderPath: erasableUnknownFolder.originalFolderPath,
    },
  })
  assert.equal(erasedUnknownFolder.response.status, 200, JSON.stringify(erasedUnknownFolder.data))
  assert.equal(erasedUnknownFolder.data.storageRemoved, true)
  assert.equal(fs.existsSync(eraseUnknownSource), false)
  assert.equal(fs.existsSync(path.join(tempRoot, 'storage', ...maintenanceOrder.data.folderPath.split('/'), 'unknown-folder')), false)
  assert.ok(!(await request(`/orders/${maintenanceOrder.data.id}`)).data.unrecognizedFolders.some((folder) => folder.id === erasableUnknownFolder.id))

  const eradicationMachine = await request('/machines', {
    method: 'POST', body: { code: 'ERADICATE-CARD-TEST', nameAr: 'ماكينة اختبار الإزالة', area: 'شرم الشيخ' },
  })
  const eradicationCard = await request(`/orders/${order.id}/cards`, {
    method: 'POST', body: { machineId: eradicationMachine.data.id },
  })
  const preservedHistoryCard = await request(`/orders/${maintenanceOrder.data.id}/cards`, {
    method: 'POST', body: { machineId: eradicationMachine.data.id },
  })
  const eradicationPhotoPath = `${order.folderPath}/${eradicationMachine.data.code}/erase-photo.png`
  const eradicationPhotoAbsolute = path.join(tempRoot, 'storage', ...eradicationPhotoPath.split('/'))
  await fs.promises.mkdir(path.dirname(eradicationPhotoAbsolute), { recursive: true })
  await fs.promises.copyFile(thumbnailSource, eradicationPhotoAbsolute)
  const eradicationPhotoUpdate = await request(`/orders/${order.id}/cards/${eradicationCard.data.id}`, {
    method: 'PATCH', body: { beforePhotos: [eradicationPhotoPath], afterPhotos: [] },
  })
  assert.equal(eradicationPhotoUpdate.response.status, 200)
  const eradicatedMachineCard = await request('/machines/eradicate', {
    method: 'DELETE', body: {
      orderId: order.id,
      cardId: eradicationCard.data.id,
      machineCode: eradicationMachine.data.code,
    },
  })
  assert.equal(eradicatedMachineCard.response.status, 200, JSON.stringify(eradicatedMachineCard.data))
  assert.equal(eradicatedMachineCard.data.storageRemoved, true)
  assert.equal(fs.existsSync(path.dirname(eradicationPhotoAbsolute)), false)
  assert.ok(!(await request(`/orders/${order.id}`)).data.cards.some((item) => item.id === eradicationCard.data.id))
  assert.ok((await request(`/orders/${maintenanceOrder.data.id}`)).data.cards.some((item) => item.id === preservedHistoryCard.data.id))
  assert.ok(!(await request('/machines')).data.some((item) => item.id === eradicationMachine.data.id))
  const eradicationDb = new Database(path.join(tempRoot, 'test.sqlite'), { readonly: true })
  try {
    const softDeletedMachine = eradicationDb.prepare('SELECT active,deleted_at FROM machines WHERE id=?').get(eradicationMachine.data.id)
    assert.equal(softDeletedMachine.active, 0)
    assert.ok(softDeletedMachine.deleted_at)
    assert.ok(eradicationDb.prepare('SELECT id FROM machines WHERE id=?').get(eradicationMachine.data.id))
    const removedCardRow = eradicationDb.prepare('SELECT excluded_at,before_photos,after_photos FROM order_machines WHERE id=?').get(eradicationCard.data.id)
    assert.ok(removedCardRow.excluded_at)
    assert.deepEqual(JSON.parse(removedCardRow.before_photos), [])
    assert.deepEqual(JSON.parse(removedCardRow.after_photos), [])
    assert.equal(eradicationDb.prepare('SELECT excluded_at FROM order_machines WHERE id=?').get(preservedHistoryCard.data.id).excluded_at, null)
    assert.ok(eradicationDb.prepare('SELECT 1 FROM audit_log WHERE entity=? AND entity_id=? AND action=?')
      .get('machine', String(eradicationMachine.data.id), 'soft-delete-machine-and-remove-order-images'))
    assert.ok(eradicationDb.prepare('SELECT deleted_at FROM area_folders WHERE id=?').get(erasableUnknownFolder.id).deleted_at)
  } finally { eradicationDb.close() }

  const card = await request(`/orders/${order.id}/cards`, { method: 'POST', body: { machineId: machine.data.id } })
  const secondPhoto = path.join(tempRoot, 'storage', 'Areas', 'manual-import', 'second-photo.png')
  await fs.promises.copyFile(thumbnailSource, secondPhoto)
  const photoPaths = ['Areas/manual-import/thumbnail-source.png', 'Areas/manual-import/second-photo.png']
  const updateCard = await request(`/orders/${order.id}/cards/${card.data.id}`, {
    method: 'PATCH', body: { beforePhotos: photoPaths, afterPhotos: [] },
  })
  assert.equal(updateCard.response.status, 200)
  const rejectPhotoAudit = new Database(path.join(tempRoot, 'test.sqlite'))
  rejectPhotoAudit.exec(`CREATE TRIGGER reject_photo_delete_audit BEFORE INSERT ON audit_log
    WHEN NEW.action='delete-photos' BEGIN SELECT RAISE(ABORT,'isolated photo audit failure'); END`)
  rejectPhotoAudit.close()
  const rolledBackPhotoDelete = await request(`/orders/${order.id}/cards/${card.data.id}/photos`, {
    method: 'DELETE', body: { paths: photoPaths },
  })
  assert.equal(rolledBackPhotoDelete.response.status, 409)
  assert.ok(photoPaths.every((photo) => fs.existsSync(path.join(tempRoot, 'storage', ...photo.split('/')))))
  const photoRollbackDb = new Database(path.join(tempRoot, 'test.sqlite'))
  assert.equal(photoRollbackDb.prepare('SELECT COUNT(*) AS count FROM filesystem_operations').get().count, 0)
  photoRollbackDb.exec('DROP TRIGGER reject_photo_delete_audit')
  photoRollbackDb.close()
  const bulkDelete = await request(`/orders/${order.id}/cards/${card.data.id}/photos`, {
    method: 'DELETE', body: { paths: photoPaths },
  })
  assert.equal(bulkDelete.response.status, 200)
  assert.equal(bulkDelete.data.removed, 2)
  assert.ok(photoPaths.every((photo) => !fs.existsSync(path.join(tempRoot, 'storage', ...photo.split('/')))))

  const excludedMachine = await request('/machines', {
    method: 'POST', body: { code: 'EXCLUDE-TEST', nameAr: 'ماكينة الاستبعاد', area: 'شرم الشيخ' },
  })
  const excludedCard = await request(`/orders/${order.id}/cards`, { method: 'POST', body: { machineId: excludedMachine.data.id } })
  const excludedPhoto = 'Areas/manual-import/exclude-photo.png'
  await sharp({ create: { width: 640, height: 480, channels: 3, background: '#6b8e5a' } }).png()
    .toFile(path.join(tempRoot, 'storage', ...excludedPhoto.split('/')))
  const excludedPhotoUpdate = await request(`/orders/${order.id}/cards/${excludedCard.data.id}`, {
    method: 'PATCH', body: { beforePhotos: [excludedPhoto], afterPhotos: [] },
  })
  assert.equal(excludedPhotoUpdate.response.status, 200)
  const exclusion = await request(`/orders/${order.id}/cards/${excludedCard.data.id}/exclude`, { method: 'POST' })
  assert.equal(exclusion.response.status, 200)
  assert.deepEqual(exclusion.data, { ok: true, excludedCardId: excludedCard.data.id, excludedPhotos: 1 })
  assert.ok(fs.existsSync(path.join(tempRoot, 'storage', ...excludedPhoto.split('/'))), 'excluding keeps source photos on disk')
  const orderAfterExclusion = await request(`/orders/${order.id}`)
  assert.ok(!orderAfterExclusion.data.cards.some((item) => item.machineCode === 'EXCLUDE-TEST'))
  assert.equal(orderAfterExclusion.data.machineCount, orderAfterExclusion.data.cards.length)
  assert.equal((await request(`/orders/${order.id}/cards/${excludedCard.data.id}/exclude`, { method: 'POST' })).response.status, 404)
  const restoredCard = await request(`/orders/${order.id}/cards`, { method: 'POST', body: { machineId: excludedMachine.data.id } })
  assert.equal(restoredCard.response.status, 201)
  assert.equal(restoredCard.data.id, excludedCard.data.id)
  assert.equal(restoredCard.data.restored, true)
  const orderAfterRestore = await request(`/orders/${order.id}`)
  assert.ok(orderAfterRestore.data.cards.some((item) => item.id === excludedCard.data.id && item.beforePhotos.includes(excludedPhoto)))

  const rejectedSocket = io(new URL(baseUrl).origin, {
    transports: ['websocket'], timeout: 5000, reconnection: false, autoConnect: false,
  })
  const socketRejection = new Promise((resolve, reject) => {
    rejectedSocket.once('connect_error', resolve)
    rejectedSocket.once('connect', () => reject(new Error('Unauthenticated Socket.IO connection was accepted.')))
  })
  rejectedSocket.connect()
  const rejection = await socketRejection
  assert.match(rejection.message, /unauthorized/i)
  rejectedSocket.disconnect()

  const operationsSocket = await connectSocket(operationsCookie)
  const salesSocket = await connectSocket(salesCookie)
  const adminSocket = await connectSocket(adminCookie)
  let salesAreaNotifications = 0
  let salesTreasuryNotifications = 0
  salesSocket.on('newAreaFolder', () => { salesAreaNotifications += 1 })
  salesSocket.on('areas:folder-added', () => { salesAreaNotifications += 1 })
  salesSocket.on('treasury:invoice-approved', () => { salesTreasuryNotifications += 1 })
  salesSocket.on('treasury:payment-recorded', () => { salesTreasuryNotifications += 1 })
  try {
    let eventTimeout
    const eventHandler = (event) => {
      if (event.name !== 'watched-folder') return
      clearTimeout(eventTimeout)
      operationsSocket.off('newAreaFolder', eventHandler)
      resolveEvent(event)
    }
    let resolveEvent
    const eventReceived = new Promise((resolve, reject) => {
      resolveEvent = resolve
      eventTimeout = setTimeout(() => {
        operationsSocket.off('newAreaFolder', eventHandler)
        reject(new Error('Timed out waiting for newAreaFolder.'))
      }, 10000)
      operationsSocket.on('newAreaFolder', eventHandler)
    })
    const legacyEventReceived = new Promise((resolve, reject) => {
      const handler = (event) => {
        if (event.name !== 'watched-folder') return
        clearTimeout(timeout)
        operationsSocket.off('areas:folder-added', handler)
        resolve(event)
      }
      const timeout = setTimeout(() => {
        operationsSocket.off('areas:folder-added', handler)
        reject(new Error('Timed out waiting for legacy areas:folder-added.'))
      }, 10000)
      operationsSocket.on('areas:folder-added', handler)
    })
    const watchedFolder = path.join(tempRoot, 'storage', 'Areas', 'watched-folder')
    fs.mkdirSync(watchedFolder)
    fs.writeFileSync(path.join(watchedFolder, 'copy-in-progress.bin'), 'partial copy')
    const notifiedTooEarly = await Promise.race([
      eventReceived.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 1800)),
    ])
    assert.equal(notifiedTooEarly, false, 'folder notifications wait for files to stabilize')
    fs.appendFileSync(path.join(watchedFolder, 'copy-in-progress.bin'), Buffer.alloc(1024))
    const notification = await eventReceived
    assert.equal(notification.name, 'watched-folder')
    assert.equal(notification.path, 'watched-folder')
    assert.ok(Number.isFinite(Date.parse(notification.addedAt)))
    assert.deepEqual(await legacyEventReceived, notification)

    const approvalEvent = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for treasury:invoice-approved.')), 5000)
      adminSocket.once('treasury:invoice-approved', (event) => { clearTimeout(timeout); resolve(event) })
    })
    const notifiedInvoice = await request('/inventory/sales', {
      method: 'POST', authCookie: adminCookie,
      headers: { 'Idempotency-Key': '37d6172d-2e3f-4b40-8a83-b4224534dc89' },
      body: { clientId: client.data.id, total: 25, notes: 'Treasury room test' },
    })
    assert.equal(notifiedInvoice.response.status, 201)
    const approvedEvent = await approvalEvent
    assert.equal(approvedEvent.id, notifiedInvoice.data.id)
    const paymentEvent = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for treasury:payment-recorded.')), 5000)
      adminSocket.once('treasury:payment-recorded', (event) => { clearTimeout(timeout); resolve(event) })
    })
    const notifiedPayment = await request(`/treasury/invoices/${notifiedInvoice.data.id}/payments`, {
      method: 'POST', authCookie: adminCookie, body: { amount: 5 },
    })
    assert.equal(notifiedPayment.response.status, 201)
    assert.equal((await paymentEvent).id, notifiedPayment.data.id)
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(salesAreaNotifications, 0)
    assert.equal(salesTreasuryNotifications, 0)
  } finally {
    operationsSocket.disconnect()
    salesSocket.disconnect()
    adminSocket.disconnect()
  }

  const form = new FormData()
  form.append('file', new Blob([
    'كود الخامة,اسم الخامة,الوحدة,المخزن الأساسي,مخزن البواقي,تكلفة الوحدة,حد إعادة الطلب\n' +
    'MAT-CSV,Imported sheet,لوح,2,0.3,20,1\n',
  ], { type: 'text/csv' }), 'inventory.csv')
  const imported = await request('/inventory/import', { method: 'POST', form })
  assert.equal(imported.response.status, 200)
  assert.deepEqual(imported.data, { added: 1, updated: 0, deactivated: 0, skipped: 0 })
  const inventoryImportArchive = await fs.promises.readdir(path.join(tempRoot, 'storage', 'Uploads', 'Excel'))
  assert.ok(inventoryImportArchive.some((name) => /^Inventory_Import_inventory_\d+_[0-9a-f-]{36}\.csv$/i.test(name)))

  const updateMaterialForm = new FormData()
  updateMaterialForm.append('file', new Blob([
    'كود الخامة,اسم الخامة,الوحدة,المخزن الأساسي,مخزن البواقي,تكلفة الوحدة,حد إعادة الطلب\n' +
    'MAT-CSV,Updated sheet,لوح,4,0.3,25,1\n',
  ], { type: 'text/csv' }), 'inventory-update.csv')
  await new Promise((resolve) => setTimeout(resolve, 1050))
  const updatedMaterial = await request('/inventory/import', { method: 'POST', form: updateMaterialForm })
  assert.deepEqual(updatedMaterial.data, { added: 0, updated: 1, deactivated: 0, skipped: 0 })
  const materialAfterUpsert = await request('/bootstrap')
  assert.equal(materialAfterUpsert.data.materials.find((row) => row.code === 'MAT-CSV').stock, 4)
  assert.equal(materialAfterUpsert.data.materials.find((row) => row.code === 'MAT-CSV').unitCost, 25)

  const exported = await request('/inventory/export.xlsx')
  assert.equal(exported.response.status, 200)
  assert.match(exported.response.headers.get('content-type'), /spreadsheetml/)
  assert.ok(exported.data.byteLength > 1000)

  const settledDashboard = await request('/finance/dashboard')
  assert.equal(settledDashboard.data.summary.income, 525)
  assert.equal(settledDashboard.data.summary.expense, 181)
  assert.equal(settledDashboard.data.summary.cashBalance, 1344)
  const paidSale = settledDashboard.data.invoices.find((invoice) => invoice.id === sale.data.id)
  assert.deepEqual([paidSale.paid_total, paidSale.remaining, paidSale.payment_status], [500, 0, 'paid'])
  const softDeletedInvoice = await request(`/invoices/${sale.data.id}`, { method: 'DELETE' })
  assert.equal(softDeletedInvoice.response.status, 409)
  const financeAfterInvoiceDelete = await request('/finance/dashboard')
  assert.equal(financeAfterInvoiceDelete.data.summary.income, 525)
  assert.ok(financeAfterInvoiceDelete.data.invoices.some((invoice) => invoice.id === sale.data.id))

  assert.equal((await request('/accounting/setup', { authCookie: salesCookie })).response.status, 403)
  assert.equal((await request('/inventory/stock-counts', { authCookie: salesCookie })).response.status, 403)
  assert.equal((await request('/payroll', { authCookie: salesCookie })).response.status, 403)
  const accountingSetup = await request('/accounting/setup')
  assert.equal(accountingSetup.response.status, 200)
  const accountsByKey = Object.fromEntries(accountingSetup.data.accounts.map((account) => [account.system_key, account]))
  const approveMapping = async (mappingKey, accountId) => {
    const response = await request(`/accounting/mappings/${encodeURIComponent(mappingKey)}`, {
      method: 'PUT', body: { accountId },
    })
    assert.equal(response.response.status, 200, response.data.error)
    return response.data
  }
  for (const [key, accountKey] of [
    ['factory_cashbox', 'factory_cashbox'], ['inventory', 'inventory'], ['customer_receivables', 'customer_receivables'],
    ['sales_revenue', 'sales_revenue'], ['sales_tax_payable', 'sales_tax_payable'],
    ['inventory_variance', 'inventory_variance'], ['employee_advances', 'employee_advances'],
    ['salary_payable', 'salary_payable'], ['payroll_expense', 'payroll_expense'],
  ]) await approveMapping(key, accountsByKey[accountKey].id)

  const adjustmentMaterial = await request('/materials', {
    method: 'POST', body: { name: 'API manual adjustment material', unit: 'piece', unitCost: 25 },
  })
  assert.equal(adjustmentMaterial.response.status, 201)
  const missingAdjustmentReason = await request(`/materials/${adjustmentMaterial.data.id}`, {
    method: 'PUT', body: { stock: 2, subStock: 0.5 },
  })
  assert.equal(missingAdjustmentReason.response.status, 400)
  const manualAdjustment = await request(`/materials/${adjustmentMaterial.data.id}`, {
    method: 'PUT', body: { stock: 2, subStock: 0.5, adjustmentReason: 'Isolated manual stock reconciliation' },
  })
  assert.equal(manualAdjustment.response.status, 200, manualAdjustment.data.error)
  const manualAdjustmentAudit = (await request('/audit?entity=material&action=update')).data
    .find((row) => row.entity_id === String(adjustmentMaterial.data.id))
  assert.deepEqual([manualAdjustmentAudit.old_values.stock, manualAdjustmentAudit.old_values.sub_stock,
    manualAdjustmentAudit.new_values.stock, manualAdjustmentAudit.new_values.sub_stock,
    manualAdjustmentAudit.new_values.adjustmentReason], [0, 0, 2, 0.5, 'Isolated manual stock reconciliation'])
  const manualAdjustmentDb = new Database(path.join(tempRoot, 'test.sqlite'), { readonly: true })
  try {
    const adjustmentMovement = manualAdjustmentDb.prepare(`SELECT id FROM inventory_movements
      WHERE material_id=? AND source_type='manual_adjustment' ORDER BY id LIMIT 1`).get(adjustmentMaterial.data.id)
    const adjustmentJournal = manualAdjustmentDb.prepare(`SELECT id,status,total_debit_cents,total_credit_cents
      FROM journal_entries WHERE source_key=?`).get(`manual-inventory-adjustment:${adjustmentMovement.id}`)
    assert.deepEqual(adjustmentJournal, { id: adjustmentJournal.id, status: 'posted', total_debit_cents: 6250, total_credit_cents: 6250 })
    assert.deepEqual(manualAdjustmentDb.prepare(`SELECT a.system_key,jl.debit_cents,jl.credit_cents FROM journal_lines jl
      JOIN accounts a ON a.id=jl.account_id WHERE jl.journal_entry_id=? ORDER BY jl.line_number`).all(adjustmentJournal.id), [
      { system_key: 'inventory', debit_cents: 6250, credit_cents: 0 },
      { system_key: 'inventory_variance', debit_cents: 0, credit_cents: 6250 },
    ])
  } finally { manualAdjustmentDb.close() }

  const taxRate = await request('/accounting/tax-rates', { method: 'POST', body: { label: 'API Test VAT', rateBasisPoints: 1400 } })
  assert.equal(taxRate.response.status, 201)
  assert.ok((await request('/accounting/tax-rates', { authCookie: salesCookie })).data.some((rate) => rate.id === taxRate.data.id))
  const cashboxBeforeCashSale = (await request('/accounting/reports')).data.cashboxBalanceCents
  const cashSaleKey = '3b3ca69b-5c64-46f5-a4ca-a778c0798fc0'
  const taxedSale = await request('/inventory/sales', {
    method: 'POST', headers: { 'Idempotency-Key': cashSaleKey },
    body: { clientId: client.data.id, subtotal: 100, taxRateBasisPoints: 1400, saleType: 'cash', notes: 'API tax test' },
  })
  assert.equal(taxedSale.response.status, 201, taxedSale.data.error)
  assert.deepEqual([taxedSale.data.subtotal, taxedSale.data.tax, taxedSale.data.total], [100, 14, 114])
  assert.deepEqual([taxedSale.data.saleType, taxedSale.data.paidTotal, taxedSale.data.remaining, taxedSale.data.paymentStatus],
    ['cash', 114, 0, 'paid'])
  const cashSaleReplay = await request('/inventory/sales', {
    method: 'POST', headers: { 'Idempotency-Key': cashSaleKey },
    body: { clientId: client.data.id, subtotal: 100, taxRateBasisPoints: 1400, saleType: 'cash', notes: 'API tax test' },
  })
  assert.equal(cashSaleReplay.data.id, taxedSale.data.id)
  assert.equal(cashSaleReplay.response.headers.get('idempotency-replayed'), 'true')
  const salesInvoiceView = await request('/sales/invoices', { authCookie: salesCookie })
  const taxedInvoiceView = salesInvoiceView.data.find((invoice) => invoice.id === taxedSale.data.id)
  assert.deepEqual([taxedInvoiceView.subtotal_cents, taxedInvoiceView.tax_cents, taxedInvoiceView.tax_rate_basis_points], [10000, 1400, 1400])
  const cashSalePosting = new Database(path.join(tempRoot, 'test.sqlite'), { readonly: true })
  try {
    assert.equal(cashSalePosting.prepare('SELECT COUNT(*) AS count FROM treasury_transactions WHERE invoice_id=?')
      .get(taxedSale.data.id).count, 1)
    const receipt = cashSalePosting.prepare(`SELECT id,kind,amount FROM treasury_transactions WHERE invoice_id=?`).get(taxedSale.data.id)
    assert.deepEqual([receipt.kind, receipt.amount], ['income', 114])
    const journal = cashSalePosting.prepare("SELECT id,status,total_debit_cents,total_credit_cents FROM journal_entries WHERE source_key=?")
      .get(`sales-invoice:${taxedSale.data.id}`)
    assert.deepEqual([journal.status, journal.total_debit_cents, journal.total_credit_cents], ['posted', 11400, 11400])
    assert.deepEqual(cashSalePosting.prepare(`SELECT a.system_key,jl.debit_cents,jl.credit_cents FROM journal_lines jl
      JOIN accounts a ON a.id=jl.account_id WHERE jl.journal_entry_id=? ORDER BY jl.line_number`).all(journal.id), [
      { system_key: 'factory_cashbox', debit_cents: 11400, credit_cents: 0 },
      { system_key: 'sales_revenue', debit_cents: 0, credit_cents: 10000 },
      { system_key: 'sales_tax_payable', debit_cents: 0, credit_cents: 1400 },
    ])
  } finally { cashSalePosting.close() }
  assert.equal((await request('/accounting/reports')).data.cashboxBalanceCents, cashboxBeforeCashSale + 11400)
  const unboundedTaxSummary = (await request('/accounting/reports')).data.taxSummary
    .find((row) => row.tax_rate_basis_points === 1400)
  assert.deepEqual([unboundedTaxSummary.subtotal_cents, unboundedTaxSummary.tax_cents, unboundedTaxSummary.invoice_count], [10000, 1400, 1])
  const fromOnlyTaxSummary = (await request('/accounting/reports?from=2000-01-01')).data.taxSummary
    .find((row) => row.tax_rate_basis_points === 1400)
  const toOnlyTaxSummary = (await request('/accounting/reports?to=2099-12-31')).data.taxSummary
    .find((row) => row.tax_rate_basis_points === 1400)
  const boundedTaxSummary = (await request('/accounting/reports?from=2000-01-01&to=2099-12-31')).data.taxSummary
    .find((row) => row.tax_rate_basis_points === 1400)
  assert.deepEqual([fromOnlyTaxSummary.invoice_count, toOnlyTaxSummary.invoice_count, boundedTaxSummary.invoice_count], [1, 1, 1])
  assert.equal((await request('/accounting/reports?from=2099-01-01')).data.taxSummary
    .some((row) => row.tax_rate_basis_points === 1400), false)
  assert.equal((await request('/accounting/reports?to=2000-01-01')).data.taxSummary
    .some((row) => row.tax_rate_basis_points === 1400), false)
  await new Promise((resolve) => setTimeout(resolve, 1050))
  const customTaxSale = await request('/inventory/sales', {
    method: 'POST', authCookie: salesCookie,
    body: { clientId: client.data.id, subtotal: 100, taxRateBasisPoints: 0,
      customTaxRate: true, customTaxPercent: '7.25', saleType: 'credit', notes: 'One-off custom tax test' },
  })
  assert.equal(customTaxSale.response.status, 201, customTaxSale.data.error)
  assert.deepEqual([customTaxSale.data.taxRateBasisPoints, customTaxSale.data.tax, customTaxSale.data.total], [725, 7.3, 107.3])
  const customTaxInvoiceDb = new Database(path.join(tempRoot, 'test.sqlite'), { readonly: true })
  try {
    assert.equal(customTaxInvoiceDb.prepare('SELECT COUNT(*) AS count FROM sales_tax_rates WHERE rate_basis_points=725').get().count, 0)
    assert.equal(customTaxInvoiceDb.prepare('SELECT COUNT(*) AS count FROM treasury_transactions WHERE invoice_id=?').get(customTaxSale.data.id).count, 0)
  } finally { customTaxInvoiceDb.close() }
  await new Promise((resolve) => setTimeout(resolve, 1050))
  assert.equal((await request('/inventory/sales', {
    method: 'POST', authCookie: salesCookie,
    body: { clientId: client.data.id, subtotal: 100, customTaxRate: true, customTaxPercent: '1000.01' },
  })).response.status, 400)
  const duplicateCashSaleReceipt = await request(`/treasury/invoices/${taxedSale.data.id}/payments`, {
    method: 'POST', authCookie: salesCookie, body: { amount: 1, reference: 'DUPLICATE-CASH-SALE-RECEIPT' },
  })
  assert.equal(duplicateCashSaleReceipt.response.status, 409)

  const standalonePurchase = await request('/inventory/purchases', {
    method: 'POST', body: { supplier: 'Variant supplier', items: [{ materialId: null, name: 'API standalone material',
      specification: 'Clear 8mm', unit: 'sheet', quantity: 2, unitCost: 20 }] },
  })
  assert.equal(standalonePurchase.response.status, 201, standalonePurchase.data.error)
  assert.equal(standalonePurchase.data.total, 40)
  const standaloneMaterialId = standalonePurchase.data.items[0].materialId
  const standaloneMaterials = await request('/materials')
  const standaloneMaterial = standaloneMaterials.data.find((item) => item.id === standaloneMaterialId)
  assert.deepEqual([standaloneMaterial.name, standaloneMaterial.specification, standaloneMaterial.stock, standaloneMaterial.unitCost],
    ['API standalone material', 'Clear 8mm', 2, 20])
  const evidenceBytes = Buffer.from('%PDF-1.7\nMadar isolated invoice evidence\n%%EOF\n')
  const evidenceForm = new FormData()
  evidenceForm.append('file', new Blob([evidenceBytes], { type: 'application/pdf' }), 'supplier-evidence.pdf')
  const evidenceUpload = await request(`/inventory/purchases/${standalonePurchase.data.id}/attachments`, {
    method: 'POST', form: evidenceForm,
  })
  assert.equal(evidenceUpload.response.status, 201, evidenceUpload.data.error)
  assert.equal(evidenceUpload.data.mime_type, 'application/pdf')
  const evidenceList = await request(`/inventory/purchases/${standalonePurchase.data.id}/attachments`)
  assert.equal(evidenceList.data.length, 1)
  const evidenceDownload = await request(`/inventory/purchases/${standalonePurchase.data.id}/attachments/${evidenceUpload.data.id}`)
  assert.equal(evidenceDownload.response.status, 200)
  assert.deepEqual(Buffer.from(evidenceDownload.data), evidenceBytes)
  assert.equal((await request(`/inventory/purchases/${standalonePurchase.data.id}/attachments`, { authCookie: salesCookie })).response.status, 403)
  assert.equal((await request(`/inventory/purchases/${standalonePurchase.data.id}/attachments/${evidenceUpload.data.id}`, {
    authCookie: salesCookie,
  })).response.status, 403)
  const invalidEvidenceForm = new FormData()
  invalidEvidenceForm.append('file', new Blob(['not a PDF'], { type: 'application/pdf' }), 'fake.pdf')
  assert.equal((await request(`/inventory/purchases/${standalonePurchase.data.id}/attachments`, {
    method: 'POST', form: invalidEvidenceForm,
  })).response.status, 415)

  const revisionPurchase = standalonePurchase
  const revisionInitial = await request(`/inventory/purchases/${revisionPurchase.data.id}`)
  assert.equal(revisionInitial.data.revisionNumber, 0)
  assert.equal(revisionInitial.data.currentValues.totalCents, 4000)
  assert.equal(revisionInitial.data.canRevise, true)
  assert.equal((await request(`/inventory/purchases/${revisionPurchase.data.id}`, { authCookie: salesCookie })).response.status, 403)
  const missingRefundConfirmation = await request(`/inventory/purchases/${revisionPurchase.data.id}/revisions`, {
    method: 'PUT', body: { expectedRevision: 0, reason: 'Correct supplier unit cost', supplier: 'Revision supplier', notes: '',
      items: [{ materialId: revisionPurchase.data.items[0].materialId, name: 'Revision fixture material',
        specification: 'API fixture', unit: 'piece', quantity: 2, unitCost: 18 }] },
  })
  assert.equal(missingRefundConfirmation.response.status, 400)
  const firstRevision = await request(`/inventory/purchases/${revisionPurchase.data.id}/revisions`, {
    method: 'PUT', body: { expectedRevision: 0, reason: 'Supplier corrected the unit price', supplier: 'Revision supplier corrected',
      notes: 'First auditable revision', supplierRefundReceived: true,
      items: [{ materialId: revisionPurchase.data.items[0].materialId, name: 'Revision fixture material',
        specification: 'API fixture', unit: 'piece', quantity: 2, unitCost: 18 }] },
  })
  assert.equal(firstRevision.response.status, 201, firstRevision.data.error)
  assert.deepEqual([firstRevision.data.revisionNumber, firstRevision.data.total, firstRevision.data.cashDeltaCents], [1, 36, -400])
  const secondRevision = await request(`/inventory/purchases/${revisionPurchase.data.id}/revisions`, {
    method: 'PUT', body: { expectedRevision: 1, reason: 'Additional units received', supplier: 'Revision supplier corrected',
      notes: 'Second auditable revision', items: [{ materialId: firstRevision.data.items[0].materialId,
        name: 'Revision fixture material', specification: 'API fixture', unit: 'piece', quantity: 3, unitCost: 18 }] },
  })
  assert.equal(secondRevision.response.status, 201, secondRevision.data.error)
  assert.deepEqual([secondRevision.data.revisionNumber, secondRevision.data.total, secondRevision.data.cashDeltaCents], [2, 54, 1800])
  const staleRevision = await request(`/inventory/purchases/${revisionPurchase.data.id}/revisions`, {
    method: 'PUT', body: { expectedRevision: 1, reason: 'Stale edit', supplier: 'stale', notes: '',
      items: [{ materialId: secondRevision.data.items[0].materialId, name: 'Revision fixture material',
        specification: 'API fixture', unit: 'piece', quantity: 1, unitCost: 18 }] },
  })
  assert.equal(staleRevision.response.status, 409)
  const revisionHistory = await request(`/inventory/purchases/${revisionPurchase.data.id}/revisions`)
  assert.deepEqual(revisionHistory.data.revisions.map((row) => row.revision_number), [2, 1])
  assert.deepEqual([revisionHistory.data.revisions[0].previous_values.totalCents,
    revisionHistory.data.revisions[0].revised_values.totalCents], [3600, 5400])
  assert.equal(revisionHistory.data.currentValues.items[0].quantity, 3)
  const revisedMaterial = (await request('/materials')).data.find((item) => item.id === secondRevision.data.items[0].materialId)
  assert.equal(revisedMaterial.stock, 3)
  const revisionJournalFilter = await request(`/accounting/journal?sourceType=purchase_invoice_revision&sourceId=${secondRevision.data.revisionId}`)
  assert.equal(revisionJournalFilter.data.length, 1)
  assert.equal(revisionJournalFilter.data[0].source_href, `/finance#purchase-invoice-${revisionPurchase.data.id}`)
  const revisionAudit = (await request('/audit?entity=invoice&action=revise-purchase')).data
    .find((row) => row.entity_id === String(revisionPurchase.data.id))
  assert.equal(revisionAudit.new_values.revisionNumber, 2)
  const issuedRevisionStock = await request('/inventory/issue', {
    method: 'POST', body: { materialId: secondRevision.data.items[0].materialId, quantity: 1, classification: 'general' },
  })
  assert.equal(issuedRevisionStock.response.status, 200)
  const issuedRevisionEdit = await request(`/inventory/purchases/${revisionPurchase.data.id}/revisions`, {
    method: 'PUT', body: { expectedRevision: 2, reason: 'Attempt to revise issued stock', supplier: 'Revision supplier', notes: '',
      items: [{ materialId: secondRevision.data.items[0].materialId, name: 'Revision fixture material',
        specification: 'API fixture', unit: 'piece', quantity: 2, unitCost: 18 }] },
  })
  assert.equal(issuedRevisionEdit.response.status, 409)
  const revisionLedgerDb = new Database(path.join(tempRoot, 'test.sqlite'), { readonly: true })
  try {
    const entries = revisionLedgerDb.prepare(`SELECT id,status,total_debit_cents,total_credit_cents FROM journal_entries
      WHERE source_type='purchase_invoice_revision' AND source_id IN (?,?) ORDER BY id`)
      .all(String(firstRevision.data.revisionId), String(secondRevision.data.revisionId))
    assert.equal(entries.length, 2)
    assert.ok(entries.every((entry) => entry.status === 'posted' && entry.total_debit_cents === entry.total_credit_cents))
    const revisionMovements = revisionLedgerDb.prepare(`SELECT source_id,quantity FROM inventory_movements
      WHERE invoice_id=? AND source_type='purchase_invoice_revision' ORDER BY id`).all(revisionPurchase.data.id)
    assert.deepEqual(revisionMovements.map((row) => row.quantity), [-2, 2, -2, 3])
  } finally { revisionLedgerDb.close() }

  assert.equal((await request(`/inventory/purchases/${purchase.data.id}/correction`, {
    method: 'POST', body: { reason: 'Issued source lot', supplierRefundReceived: true },
  })).response.status, 409)
  await new Promise((resolve) => setTimeout(resolve, 1050))
  const correctionPurchase = await request('/inventory/purchases', {
    method: 'POST', body: { supplier: 'Refund fixture supplier', items: [{ materialId: null, name: 'Refund fixture material',
      specification: 'API fixture', unit: 'piece', quantity: 2, unitCost: 20 }] },
  })
  assert.equal(correctionPurchase.response.status, 201, correctionPurchase.data.error)
  const correctionMaterialId = correctionPurchase.data.items[0].materialId
  assert.equal((await request(`/inventory/purchases/${correctionPurchase.data.id}/correction`, {
    method: 'POST', body: { reason: 'No refund confirmation' },
  })).response.status, 400)
  const correction = await request(`/inventory/purchases/${correctionPurchase.data.id}/correction`, {
    method: 'POST', body: { reason: 'Supplier refunded the unissued purchase', supplierRefundReceived: true },
  })
  assert.equal(correction.response.status, 201, correction.data.error)
  assert.equal(correction.data.refundedAmount, 40)
  assert.equal((await request('/materials')).data.find((item) => item.id === correctionMaterialId).stock, 0)
  const correctedInvoice = (await request('/finance/dashboard')).data.invoices.find((invoice) => invoice.id === correctionPurchase.data.id)
  assert.equal(correctedInvoice.status, 'corrected')

  const countOffcut = await request('/warehouse/offcuts', { method: 'POST', body: {
    materialId: material.data.id, name: 'Counted acrylic remnant', dimensions: '20x30 cm', quantity: 0.4, unit: 'sheet',
  } })
  assert.equal(countOffcut.response.status, 201, countOffcut.data.error)
  const stockCount = await request('/inventory/stock-counts', {
    method: 'POST', body: { reason: 'Isolated stock-count API test', materialIds: [material.data.id] },
  })
  assert.equal(stockCount.response.status, 201, stockCount.data.error)
  assert.equal((await request('/inventory/stock-counts', { method: 'POST', body: { materialIds: [material.data.id] } })).response.status, 400)
  assert.equal((await request('/inventory/issue', { method: 'POST', body: { materialId: material.data.id, quantity: 1, classification: 'general' } })).response.status, 409)
  assert.equal((await request(`/materials/${material.data.id}`, { method: 'DELETE' })).response.status, 409)
  const unrelatedCountMaterial = await request('/materials', { method: 'POST', body: { name: 'Unrelated stock-count SKU', stock: 1, unitCost: 10 } })
  assert.equal(unrelatedCountMaterial.response.status, 201)
  assert.equal((await request('/inventory/issue', { method: 'POST', body: {
    materialId: unrelatedCountMaterial.data.id, quantity: 1, classification: 'general',
  } })).response.status, 200)
  assert.equal((await request(`/inventory/stock-counts/${stockCount.data.id}/approve`, { method: 'POST', body: {} })).response.status, 409)
  const stockCountDetails = await request(`/inventory/stock-counts/${stockCount.data.id}`)
  assert.equal(stockCountDetails.data.items.length, 1)
  assert.equal(stockCountDetails.data.offcuts.length, 1)
  assert.equal(stockCountDetails.data.offcuts[0].offcut_id, countOffcut.data.id)
  assert.equal((await request('/warehouse/scrap-sales', { method: 'POST', body: {
    amount: 1, items: [{ offcutId: countOffcut.data.id, quantity: 0.1 }],
  } })).response.status, 409)
  const counted = stockCountDetails.data.items[0]
  const actualCount = await request(`/inventory/stock-counts/${stockCount.data.id}/items`, {
    method: 'PUT', body: { items: [{ materialId: material.data.id, stock: counted.recorded_stock - 1, subStock: counted.recorded_sub_stock }],
      offcuts: [{ offcutId: countOffcut.data.id, quantity: 0.4 }] },
  })
  assert.equal(actualCount.response.status, 200)
  const countEditAudit = (await request(`/audit?entity=stock-count&action=count-items`)).data
    .find((row) => row.entity_id === String(stockCount.data.id))
  assert.equal(countEditAudit.old_values.items[0].counted_stock, null)
  assert.equal(countEditAudit.new_values.items[0].counted_stock, counted.recorded_stock - 1)
  const approvedCount = await request(`/inventory/stock-counts/${stockCount.data.id}/approve`, { method: 'POST', body: {} })
  assert.equal(approvedCount.response.status, 200, approvedCount.data.error)
  assert.equal(approvedCount.data.varianceCents, -10000)
  const countLedgerDb = new Database(path.join(tempRoot, 'test.sqlite'), { readonly: true })
  try {
    assert.equal(countLedgerDb.prepare('SELECT variance FROM stock_count_items WHERE count_id=?').get(stockCount.data.id).variance, -1)
    assert.equal(countLedgerDb.prepare('SELECT variance FROM stock_count_offcut_items WHERE count_id=?').get(stockCount.data.id).variance, 0)
    assert.equal(countLedgerDb.prepare("SELECT status FROM journal_entries WHERE source_key=?").get(`stock-count:${stockCount.data.id}`).status, 'posted')
  } finally { countLedgerDb.close() }
  const countApprovalAudit = (await request('/audit?entity=stock-count&action=approve')).data
    .find((row) => row.entity_id === String(stockCount.data.id))
  assert.deepEqual([countApprovalAudit.new_values.items[0].counted_stock,
    countApprovalAudit.new_values.items[0].recorded_stock, countApprovalAudit.new_values.items[0].variance],
  [counted.recorded_stock - 1, counted.recorded_stock, -1])

  const utilityAccount = await request('/accounting/accounts', {
    method: 'POST', body: { code: 'API-EXP-1', name: 'API Test Utilities', accountType: 'expense' },
  })
  assert.equal(utilityAccount.response.status, 201)
  const otherInvoice = await request('/other-invoices', {
    method: 'POST', body: { supplier: 'Utility supplier', items: [
      { description: 'Electricity', category: 'API Utilities', amount: 10.25 },
      { description: 'Cleaning', category: 'API Cleaning', amount: 5.75 },
    ] },
  })
  assert.equal(otherInvoice.response.status, 201, otherInvoice.data.error)
  assert.equal(otherInvoice.data.total, 16)
  const otherEvidenceBytes = Buffer.from('%PDF-1.7\nMadar isolated other-expense evidence\n%%EOF\n')
  const otherEvidenceForm = new FormData()
  otherEvidenceForm.append('file', new Blob([otherEvidenceBytes], { type: 'application/pdf' }), 'expense-evidence.pdf')
  const otherEvidenceUpload = await request(`/other-invoices/${otherInvoice.data.id}/attachments`, {
    method: 'POST', form: otherEvidenceForm,
  })
  assert.equal(otherEvidenceUpload.response.status, 201, otherEvidenceUpload.data.error)
  const otherEvidenceList = await request(`/other-invoices/${otherInvoice.data.id}/attachments`)
  assert.equal(otherEvidenceList.data.length, 1)
  const otherEvidenceDownload = await request(`/other-invoices/${otherInvoice.data.id}/attachments/${otherEvidenceUpload.data.id}`)
  assert.equal(otherEvidenceDownload.response.status, 200)
  assert.deepEqual(Buffer.from(otherEvidenceDownload.data), otherEvidenceBytes)
  assert.equal((await request(`/other-invoices/${otherInvoice.data.id}/attachments`, { authCookie: salesCookie })).response.status, 403)
  const otherInvoiceRows = await request('/other-invoices')
  const listedOtherInvoice = otherInvoiceRows.data.find((invoice) => invoice.id === otherInvoice.data.id)
  assert.equal(listedOtherInvoice.lines.length, 2)
  for (const line of listedOtherInvoice.lines) await approveMapping(`expense_category:${line.category_id}`, utilityAccount.data.id)
  const otherInvoiceJournal = await request('/accounting/journal?sourceType=other_invoice')
  assert.equal(otherInvoiceJournal.data.find((entry) => entry.source_id === String(otherInvoice.data.id)).status, 'posted')
  assert.equal((await request('/other-invoices', { authCookie: salesCookie })).response.status, 403)

  const salaryUpdate = await request(`/employees/${maintenanceEmployee.data.id}`, {
    method: 'PATCH', body: { name: 'Test Maintenance', department: 'Maintenance', phone: '555-0199', monthlyBaseSalary: 100 },
  })
  assert.equal(salaryUpdate.response.status, 200)
  const advance = await request('/payroll/advances', {
    method: 'POST', body: { employeeId: maintenanceEmployee.data.id, amount: 20, notes: 'API payroll advance' },
  })
  assert.equal(advance.response.status, 201, advance.data.error)
  assert.equal(advance.data.outstandingAdvanceCents, 2000)
  const payrollDraft = await request('/payroll', {
    method: 'POST', body: { employeeId: maintenanceEmployee.data.id, period: '2026-09' },
  })
  assert.equal(payrollDraft.response.status, 201, payrollDraft.data.error)
  assert.deepEqual([payrollDraft.data.absence_days, payrollDraft.data.absence_deduction_cents,
    payrollDraft.data.ordinary_overtime_minutes, payrollDraft.data.holiday_overtime_minutes], [2, 769, 60, 60])
  const finalizedPayroll = await request(`/payroll/${payrollDraft.data.id}/finalize`, {
    method: 'POST', body: { cashPaid: 50 },
  })
  assert.equal(finalizedPayroll.response.status, 200, finalizedPayroll.data.error)
  assert.deepEqual([finalizedPayroll.data.advances_applied_cents, finalizedPayroll.data.cash_paid_cents,
    finalizedPayroll.data.unpaid_salary_cents], [2000, 5000, 2380])
  assert.equal((await request(`/payroll/${payrollDraft.data.id}/finalize`, { method: 'POST', body: {} })).response.status, 409)
  const salaryPayment = await request(`/payroll/${payrollDraft.data.id}/payments`, { method: 'POST', body: { amount: 23.80 } })
  assert.equal(salaryPayment.response.status, 201)
  assert.equal(salaryPayment.data.unpaidSalaryCents, 0)
  const employeeHistory = await request(`/employees/${maintenanceEmployee.data.id}/history`)
  assert.equal(employeeHistory.response.status, 200, employeeHistory.data.error)
  assert.equal(employeeHistory.data.employee.id, maintenanceEmployee.data.id)
  assert.equal(employeeHistory.data.summary.payrollPeriodCount, 1)
  assert.equal(employeeHistory.data.summary.payrollEntitlementCents, 9380)
  assert.equal(employeeHistory.data.summary.advancesIssuedCents, 2000)
  assert.equal(employeeHistory.data.summary.advancesAppliedCents, 2000)
  assert.equal(employeeHistory.data.summary.currentAdvanceBalanceCents, 0)
  assert.ok(employeeHistory.data.events.some((event) => event.type === 'payroll' && event.payrollId === payrollDraft.data.id))
  assert.ok(employeeHistory.data.events.some((event) => event.type === 'advance' && event.eventType === 'issued'))
  assert.ok(employeeHistory.data.events.some((event) => event.type === 'treasury' && event.transactionId))
  assert.ok(employeeHistory.data.events.some((event) => event.type === 'audit' && event.oldValues && event.newValues))
  assert.equal((await request(`/employees/${maintenanceEmployee.data.id}/history`, { authCookie: salesCookie })).response.status, 403)
  assert.equal((await request(`/employees/${maintenanceEmployee.data.id}/history?from=2026-02-30`)).response.status, 400)
  const futureHistory = await request(`/employees/${maintenanceEmployee.data.id}/history?from=2999-01-01`)
  assert.equal(futureHistory.response.status, 200)
  assert.equal(futureHistory.data.events.length, 0)
  const employeeHistoryXlsx = await request(`/employees/${maintenanceEmployee.data.id}/history.xlsx`)
  assert.equal(employeeHistoryXlsx.response.status, 200, employeeHistoryXlsx.response.headers.get('content-type'))
  assert.match(employeeHistoryXlsx.response.headers.get('content-type'), /spreadsheetml\.sheet/)
  const employeeWorkbook = XLSX.read(Buffer.from(employeeHistoryXlsx.data), { type: 'buffer' })
  assert.deepEqual(employeeWorkbook.SheetNames, ['ملخص الموظف', 'السجل الوظيفي'])
  assert.ok(XLSX.utils.sheet_to_json(employeeWorkbook.Sheets['السجل الوظيفي'], { header: 1 })
    .some((row) => String(row[2] || '').includes('مسير رواتب 2026-09')))
  const employeeHistoryPdf = await request(`/employees/${maintenanceEmployee.data.id}/history.pdf`)
  assert.equal(employeeHistoryPdf.response.status, 200, employeeHistoryPdf.data.toString().slice(0, 200))
  assert.match(employeeHistoryPdf.response.headers.get('content-type'), /application\/pdf/)
  assert.ok(Buffer.from(employeeHistoryPdf.data).subarray(0, 5).equals(Buffer.from('%PDF-')))

  const openingBatch = await request('/accounting/opening-balances', {
    method: 'POST', body: { cutoverDate: '2025-01-01', lines: [
      { lineType: 'cashbox', accountId: accountsByKey.factory_cashbox.id, side: 'debit', amount: 75, description: 'Opening cash' },
      { lineType: 'receivable', accountId: accountsByKey.customer_receivables.id, clientId: client.data.id,
        invoiceCode: 'LEGACY-AR-1', originalDate: '2024-12-01', dueDate: '2025-01-15', side: 'debit', amount: 25 },
      { lineType: 'account', accountId: accountsByKey.opening_equity.id, side: 'credit', amount: 100, description: 'Opening equity' },
    ] },
  })
  assert.equal(openingBatch.response.status, 201, openingBatch.data.error)
  assert.equal(openingBatch.data.balanced, true)
  const updatedOpeningDraft = await request('/accounting/opening-balances', {
    method: 'POST', body: { cutoverDate: '2025-01-01', lines: [
      { lineType: 'cashbox', accountId: accountsByKey.factory_cashbox.id, side: 'debit', amount: 75, description: 'Opening cash revised' },
      { lineType: 'receivable', accountId: accountsByKey.customer_receivables.id, clientId: client.data.id,
        invoiceCode: 'LEGACY-AR-1', originalDate: '2024-12-01', dueDate: '2025-01-15', side: 'debit', amount: 30 },
      { lineType: 'account', accountId: accountsByKey.opening_equity.id, side: 'credit', amount: 105, description: 'Opening equity revised' },
    ] },
  })
  assert.equal(updatedOpeningDraft.response.status, 201, updatedOpeningDraft.data.error)
  assert.equal(updatedOpeningDraft.data.id, openingBatch.data.id)
  const openingDraftAudit = (await request('/audit?entity=opening-balance&action=update-draft')).data
    .find((row) => row.entity_id === String(openingBatch.data.id))
  assert.deepEqual([openingDraftAudit.old_values.lines[1].amount_cents, openingDraftAudit.new_values.lines[1].amount_cents], [2500, 3000])
  assert.deepEqual([openingDraftAudit.old_values.lines[0].description, openingDraftAudit.new_values.lines[0].description],
    ['Opening cash', 'Opening cash revised'])
  const postedOpeningBatch = await request(`/accounting/opening-balances/${openingBatch.data.id}/post`, { method: 'POST', body: {} })
  assert.equal(postedOpeningBatch.response.status, 200, postedOpeningBatch.data.error)
  assert.equal((await request('/accounting/opening-balances')).data.find((batch) => batch.id === openingBatch.data.id).status, 'posted')
  assert.equal((await request(`/accounting/opening-balances/${openingBatch.data.id}/post`, { method: 'POST', body: {} })).response.status, 404)
  const openingRows = (await request('/accounting/opening-balances')).data
  const receivableScheduleLine = openingRows.find((batch) => batch.id === openingBatch.data.id).lines.find((line) => line.line_type === 'receivable')
  assert.deepEqual([receivableScheduleLine.invoice_code, receivableScheduleLine.original_date, receivableScheduleLine.due_date],
    ['LEGACY-AR-1', '2024-12-01', '2025-01-15'])
  const otherCutover = await request('/accounting/opening-balances', {
    method: 'POST', body: { cutoverDate: '2025-01-02', lines: [
      { lineType: 'account', accountId: accountsByKey.opening_equity.id, side: 'debit', amount: 1 },
      { lineType: 'account', accountId: accountsByKey.opening_equity.id, side: 'credit', amount: 1 },
    ] },
  })
  assert.equal(otherCutover.response.status, 409)
  const treasuryAfterCutoverDb = new Database(path.join(tempRoot, 'test.sqlite'), { readonly: true })
  try {
    const movementBalance = treasuryAfterCutoverDb.prepare(`SELECT COALESCE(SUM(CASE WHEN kind='income' THEN amount ELSE -amount END),0) AS amount
      FROM treasury_transactions WHERE created_at>='2025-01-01 00:00:00'`).get().amount
    assert.equal((await request('/accounting/reports')).data.cashboxBalanceCents, Math.round(Number(movementBalance) * 100) + 7500)
    assert.equal((await request('/finance/dashboard')).data.summary.cashBalance, Math.round(Number(movementBalance) * 100) / 100 + 75)
  } finally { treasuryAfterCutoverDb.close() }
  const accountingBaseline = await request('/accounting/reports?to=2099-12-31')
  const futureOnlyAccounting = await request('/accounting/reports?from=2099-01-01&to=2099-12-31')
  assert.deepEqual(futureOnlyAccounting.data.balanceSheet.map((row) => [row.id, row.balance_cents]),
    accountingBaseline.data.balanceSheet.map((row) => [row.id, row.balance_cents]))
  assert.ok(futureOnlyAccounting.data.incomeStatement.every((row) => row.balance_cents === 0))
  assert.deepEqual((await request('/accounting/trial-balance?from=2099-01-01&to=2099-12-31')).data.totals,
    { debitCents: 0, creditCents: 0 })
  const lowStockMaterial = await request('/materials', {
    method: 'POST', body: { name: 'API notification material', unit: 'piece', stock: 0, minStock: 1 },
  })
  assert.equal(lowStockMaterial.response.status, 201)
  const firstNotificationSync = await request('/notifications')
  let lowStockNotification = firstNotificationSync.data.find((row) => row.notification_key === `low_stock:${lowStockMaterial.data.id}`)
  assert.ok(lowStockNotification)
  assert.equal((await request(`/notifications/${lowStockNotification.id}/review`, { method: 'POST', body: {} })).response.status, 200)
  await request(`/materials/${lowStockMaterial.data.id}`, {
    method: 'PUT', body: { name: 'API notification material', unit: 'piece', stock: 2, subStock: 0, minStock: 1, unitCost: 0, adjustmentReason: 'Isolated notification fixture' },
  })
  const resolvedNotificationSync = await request('/notifications')
  lowStockNotification = resolvedNotificationSync.data.find((row) => row.id === lowStockNotification.id)
  assert.ok(lowStockNotification.resolved_at)
  const notificationSocket = await connectSocket(adminCookie)
  try {
    const reactivationEvent = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for system:notification.')), 3000)
      notificationSocket.on('system:notification', function onNotification(event) {
        if (event.notification_key !== `low_stock:${lowStockMaterial.data.id}`) return
        clearTimeout(timer)
        notificationSocket.off('system:notification', onNotification)
        resolve(event)
      })
    })
    await request(`/materials/${lowStockMaterial.data.id}`, {
      method: 'PUT', body: { name: 'API notification material', unit: 'piece', stock: 0, subStock: 0, minStock: 1, unitCost: 0, adjustmentReason: 'Isolated notification fixture' },
    })
    await request('/notifications')
    const reactivatedEvent = await reactivationEvent
    assert.equal(reactivatedEvent.notification_key, `low_stock:${lowStockMaterial.data.id}`)
    const reactivatedNotification = (await request('/notifications')).data.find((row) => row.id === lowStockNotification.id)
    assert.equal(reactivatedNotification.reviewed_at, null)
    assert.equal(reactivatedNotification.resolved_at, null)
  } finally { notificationSocket.disconnect() }

  const archiveSourcePath = path.join(tempRoot, 'storage', 'Areas', 'manual-import', 'archive-source.png')
  await fs.promises.writeFile(archiveSourcePath, sourceBytes)
  const reportOrder = await request('/orders', { method: 'POST', body: { clientId: client.data.id } })
  await new Promise((resolve) => setTimeout(resolve, 1050))
  const custodyOrder = await request('/orders', { method: 'POST', body: {
    clientId: client.data.id, type: 'maintenance', machineIds: [arabicMachine.data.id],
  } })
  assert.equal(custodyOrder.response.status, 201, custodyOrder.data.error)
  const custodyOrderSummary = (await request('/bootstrap')).data.orders.find((order) => order.id === custodyOrder.data.id)
  assert.equal(custodyOrderSummary.areaNames, 'شرم الشيخ')
  const maintenanceBootstrap = await request('/bootstrap')
  const maintenanceCountDb = new Database(path.join(tempRoot, 'test.sqlite'), { readonly: true })
  try {
    assert.equal(maintenanceBootstrap.data.stats.activeMaintenanceOrders, maintenanceCountDb.prepare(
      "SELECT COUNT(*) AS count FROM orders WHERE type='maintenance' AND status!='archived' AND deleted_at IS NULL",
    ).get().count)
    assert.equal(maintenanceBootstrap.data.stats.pendingReviewMaintenance, maintenanceCountDb.prepare(
      "SELECT COUNT(*) AS count FROM orders WHERE type='maintenance' AND status='review' AND deleted_at IS NULL",
    ).get().count)
  } finally { maintenanceCountDb.close() }
  const maintenanceCashCustody = await request(`/orders/${custodyOrder.data.id}/petty-cash`, {
    method: 'POST', body: { amount: 50, notes: 'Maintenance custody test' },
  })
  assert.equal(maintenanceCashCustody.response.status, 201, maintenanceCashCustody.data.error)
  const maintenanceMaterialIssue = await request('/inventory/issue', {
    method: 'POST', body: { materialId: material.data.id, quantity: 2, warehouse: 'main',
      classification: 'order', orderId: custodyOrder.data.id },
  })
  assert.equal(maintenanceMaterialIssue.response.status, 200, maintenanceMaterialIssue.data.error)
  const archivedOrderIssue = await request('/inventory/issue', {
    method: 'POST', body: { materialId: purchase.data.items[0].materialId, quantity: 0.25,
      warehouse: 'sub', classification: 'order', orderId: reportOrder.data.id },
  })
  assert.equal(archivedOrderIssue.response.status, 200, archivedOrderIssue.data.error)
  const reportCard = await request(`/orders/${reportOrder.data.id}/cards`, { method: 'POST', body: { machineId: machine.data.id } })
  const reportCardUpdate = await request(`/orders/${reportOrder.data.id}/cards/${reportCard.data.id}`, {
    method: 'PATCH', body: {
      beforePhotos: ['Areas/manual-import/archive-source.png'], afterPhotos: [], note: 'PRIVATE-CLIENT-NOTE-CANARY',
    },
  })
  assert.equal(reportCardUpdate.response.status, 200)
  const archivedExcludedPhoto = 'Areas/manual-import/archive-excluded.png'
  await fs.promises.writeFile(path.join(tempRoot, 'storage', ...archivedExcludedPhoto.split('/')), sourceBytes)
  const archivedExcludedCard = await request(`/orders/${reportOrder.data.id}/cards`, {
    method: 'POST', body: { machineId: excludedMachine.data.id },
  })
  await request(`/orders/${reportOrder.data.id}/cards/${archivedExcludedCard.data.id}`, {
    method: 'PATCH', body: { beforePhotos: [archivedExcludedPhoto], afterPhotos: [] },
  })
  assert.equal((await request(`/orders/${reportOrder.data.id}/cards/${archivedExcludedCard.data.id}/exclude`, { method: 'POST' })).response.status, 200)
  const archivedReport = await request(`/orders/${reportOrder.data.id}/archive`, { method: 'POST', body: {} })
  assert.equal(archivedReport.response.status, 200, archivedReport.data.error)
  await new Promise((resolve) => setTimeout(resolve, 1050))
  const archivedCustody = await request(`/orders/${custodyOrder.data.id}/archive`, { method: 'POST', body: {
    actualExpenses: 30, warrantyPeriodMonths: 6,
    materialsReconciled: [{ materialId: material.data.id, consumedQuantity: 1 }],
  } })
  assert.equal(archivedCustody.response.status, 200, archivedCustody.data.error)
  assert.equal(archivedCustody.data.pettyCashRefund, 20)
  assert.equal(archivedCustody.data.warrantyPeriodMonths, 6)
  assert.match(archivedCustody.data.warrantyExpiresAt, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(archivedCustody.data.materialReturns[0].returnedQuantity, 1)
  const settlementDb = new Database(path.join(tempRoot, 'test.sqlite'), { readonly: true })
  try {
    const settledOrder = settlementDb.prepare(`SELECT petty_cash_amount_cents,actual_expenses_cents,petty_cash_settled,
        warranty_period_months,warranty_expires_at,materials_reconciled FROM orders WHERE id=?`).get(custodyOrder.data.id)
    assert.equal(settledOrder.petty_cash_amount_cents, 5000)
    assert.equal(settledOrder.actual_expenses_cents, 3000)
    assert.equal(settledOrder.petty_cash_settled, 1)
    assert.equal(settledOrder.warranty_period_months, 6)
    assert.equal(JSON.parse(settledOrder.materials_reconciled)[0].returnedQuantity, 1)
    assert.equal(settlementDb.prepare(`SELECT amount FROM treasury_transactions
      WHERE order_id=? AND kind='income' AND category='رد متبقي العهدة النقدية'`).get(custodyOrder.data.id).amount, 20)
    assert.equal(settlementDb.prepare('SELECT stock FROM materials WHERE id=?').get(material.data.id).stock, 3)
    assert.equal(settlementDb.prepare('SELECT COUNT(*) AS count FROM maintenance_order_settlements WHERE order_id=?')
      .get(custodyOrder.data.id).count, 1)
  } finally { settlementDb.close() }
  const directArchiveOrder = await request('/orders', { method: 'POST', body: {
    clientId: client.data.id, type: 'maintenance', machineIds: [arabicMachine.data.id],
  } })
  assert.equal(directArchiveOrder.response.status, 201, directArchiveOrder.data.error)
  await new Promise((resolve) => setTimeout(resolve, 1050))
  const directMaintenanceArchive = await request(`/orders/${directArchiveOrder.data.id}/archive`, { method: 'POST', body: {} })
  assert.equal(directMaintenanceArchive.response.status, 200, directMaintenanceArchive.data.error)
  assert.equal(directMaintenanceArchive.data.warrantyPeriodMonths, 3)
  assert.equal(directMaintenanceArchive.data.pettyCashRefund, 0)
  const directArchiveSummary = (await request('/bootstrap')).data.orders.find((order) => order.id === directArchiveOrder.data.id)
  assert.equal(directArchiveSummary.status, 'archived')
  const reportOrderIssueRow = (await request(`/orders/${reportOrder.data.id}`)).data.inventoryIssues[0]
  const recognizedCogsJournal = (await request('/accounting/journal?sourceType=work_order_cogs_recognition')).data
    .find((entry) => entry.source_key === `work-order-cogs:${reportOrder.data.id}:issue:${reportOrderIssueRow.id}`)
  assert.equal(recognizedCogsJournal.status, 'posted')
  assert.ok(recognizedCogsJournal.lines.some((line) => line.account_id === manufacturingAccountIds.work_order_cogs
    && line.debit_cents === reportOrderIssueRow.cogs_cents))
  assert.ok(recognizedCogsJournal.lines.some((line) => line.account_id === manufacturingAccountIds.work_order_wip
    && line.credit_cents === reportOrderIssueRow.cogs_cents))
  const nonAdminArchivedEdit = await request(`/orders/${reportOrder.data.id}`, {
    authCookie: salesCookie, method: 'PUT', body: {
      clientId: client.data.id, type: 'operation', notes: 'Rejected non-admin archive edit',
      materialCost: 25, operatingCost: 15, sellingPrice: 120,
    },
  })
  assert.equal(nonAdminArchivedEdit.response.status, 403)
  const editArchivedOrder = await request(`/orders/${reportOrder.data.id}`, {
    authCookie: adminCookie,
    method: 'PUT', body: {
      clientId: client.data.id,
      type: 'operation',
      notes: 'Edited after archive',
      materialCost: 25,
      operatingCost: 15,
      sellingPrice: 120,
    },
  })
  assert.equal(editArchivedOrder.response.status, 200)
  assert.equal(editArchivedOrder.data.status, 'archived')
  const archivedReportDetail = await request(`/orders/${reportOrder.data.id}`)
  assert.equal(Object.hasOwn(archivedReportDetail.data, 'title'), false)
  assert.equal(archivedReportDetail.data.notes, 'Edited after archive')
  assert.equal(archivedReportDetail.data.totalCost, 40)
  assert.equal(archivedReportDetail.data.status, 'archived')
  const archivedOrderHistory = await request(`/orders/${reportOrder.data.id}/history`, { authCookie: adminCookie })
  const archivedEditSnapshot = archivedOrderHistory.data.find((entry) => entry.action === 'admin-edit-archived-order')
  assert.ok(archivedEditSnapshot)
  assert.equal(archivedEditSnapshot.new_values.actor_id, 1)
  assert.equal(archivedEditSnapshot.new_values.version_number, 1)
  assert.ok(archivedEditSnapshot.new_values.timestamp)
  assert.equal(archivedEditSnapshot.old_values.before_snapshot.order.status, 'archived')
  assert.equal(archivedEditSnapshot.new_values.after_snapshot.order.notes, 'Edited after archive')
  const archivedImageRelative = archivedReportDetail.data.cards[0].beforePhotos[0]
  const archivedImagePath = path.join(tempRoot, 'storage', ...archivedImageRelative.split('/'))
  assert.equal(crypto.createHash('sha256').update(await fs.promises.readFile(archivedImagePath)).digest('hex'), sourceHash)
  assert.equal(crypto.createHash('sha256').update(await fs.promises.readFile(archiveSourcePath)).digest('hex'), sourceHash)
  const archiveMetadata = JSON.parse(await fs.promises.readFile(path.join(tempRoot, 'storage', ...reportOrder.data.folderPath.split('/'), 'Archive', 'order.json'), 'utf8'))
  assert.equal(archiveMetadata.excludedMachines.length, 1)
  assert.equal(archiveMetadata.excludedMachines[0].machineCode, 'EXCLUDE-TEST')
  assert.equal(archiveMetadata.excludedMachines[0].before.length, 1)
  const excludedArchivePath = path.join(tempRoot, 'storage', ...archiveMetadata.excludedMachines[0].before[0].split('/'))
  assert.equal(crypto.createHash('sha256').update(await fs.promises.readFile(excludedArchivePath)).digest('hex'), sourceHash)
  assert.ok(!archivedReportDetail.data.cards.some((item) => item.machineCode === 'EXCLUDE-TEST'))
  const pptx = await request(`/reports/export.pptx?ids=${reportOrder.data.id}`)
  assert.equal(pptx.response.status, 200)
  assert.match(pptx.response.headers.get('content-type'), /presentationml/)
  assert.ok(pptx.data.byteLength > 1000)
  const clientReportPptx = await JSZip.loadAsync(Buffer.from(pptx.data))
  const clientReportPptxText = (await Promise.all(Object.values(clientReportPptx.files)
    .filter((file) => !file.dir && file.name.startsWith('ppt/') && file.name.endsWith('.xml'))
    .map((file) => file.async('string')))).join('\n')
  assert.equal(clientReportPptxText.includes('PRIVATE-CLIENT-NOTE-CANARY'), false)
  const docx = await request(`/reports/export.docx?ids=${reportOrder.data.id}`)
  assert.equal(docx.response.status, 200)
  assert.match(docx.response.headers.get('content-type'), /wordprocessingml/)
  assert.ok(docx.data.byteLength > 1000)

  const backup = await request('/system/backups', { method: 'POST', body: {} })
  assert.equal(backup.response.status, 201, JSON.stringify(backup.data))
  const backupPath = path.join(tempRoot, 'Backups', backup.data.file)
  assert.ok(fs.existsSync(backupPath))
  assert.deepEqual((await fs.promises.readFile(backupPath)).subarray(0, 2), Buffer.from('PK'))

  const analysisDoneMachine = await request('/machines', {
    method: 'POST', body: { code: 'ANALYSIS-DONE', nameAr: 'ماكينة منجزة', area: 'North' },
  })
  assert.equal(analysisDoneMachine.response.status, 201)
  const analysisMissingMachine = await request('/machines', {
    method: 'POST', body: { code: 'ANALYSIS-MISSING', nameAr: 'ماكينة غير منجزة', area: 'North' },
  })
  assert.equal(analysisMissingMachine.response.status, 201)
  await new Promise((resolve) => setTimeout(resolve, 1050))
  const analysisOrder = await request('/orders', {
    method: 'POST',
    body: {
      clientId: client.data.id, type: 'maintenance', assignedEmployeeId: maintenanceEmployee.data.id,
      machineIds: [analysisDoneMachine.data.id],
    },
  })
  assert.equal(analysisOrder.response.status, 201)
  assert.deepEqual(analysisOrder.data.machineIds, [analysisDoneMachine.data.id])
  const analysisOrderDetails = await request(`/orders/${analysisOrder.data.id}`)
  assert.deepEqual(analysisOrderDetails.data.cards.map((card) => card.machineId), [analysisDoneMachine.data.id])
  const analysisReasonId = (await request('/bootstrap')).data.reasons[0].id
  const analysisCard = analysisOrderDetails.data.cards[0]
  const analysisCardUpdate = await request(`/orders/${analysisOrder.data.id}/cards/${analysisCard.id}`, {
    method: 'PATCH', body: { reasonIds: [analysisReasonId], note: 'INTERNAL-NOTES-CANARY-DONE' },
  })
  assert.equal(analysisCardUpdate.response.status, 200)
  assert.equal((await request(`/orders/${analysisOrder.data.id}/archive`, { method: 'POST', body: {} })).response.status, 200)

  const areaAnalysis = await request('/analysis/areas')
  assert.equal(areaAnalysis.response.status, 200)
  const northAnalysis = areaAnalysis.data.areas.find((item) => item.area === 'North')
  assert.ok(northAnalysis)
  assert.equal(northAnalysis.total_count, 2)
  assert.equal(northAnalysis.completed_count, 1)
  assert.deepEqual(northAnalysis.missing_machines.map((item) => item.id), [analysisMissingMachine.data.id])
  assert.equal(northAnalysis.completion_ratio, 50)
  assert.equal((await request('/analysis/areas?from=2099-02-31')).response.status, 400)

  await new Promise((resolve) => setTimeout(resolve, 1050))
  const mergedAreaMachine = await request('/machines', {
    method: 'POST', body: { code: 'ANALYSIS-MERGED', nameAr: 'ماكينة من أمر آخر', area: 'North' },
  })
  const secondAnalysisOrder = await request('/orders', {
    method: 'POST', body: {
      clientId: client.data.id, type: 'maintenance', assignedEmployeeId: maintenanceEmployee.data.id,
      machineIds: [mergedAreaMachine.data.id],
    },
  })
  assert.equal(secondAnalysisOrder.response.status, 201)
  const secondAnalysisOrderDetails = await request(`/orders/${secondAnalysisOrder.data.id}`)
  const secondAnalysisCard = secondAnalysisOrderDetails.data.cards[0]
  assert.equal((await request(`/orders/${secondAnalysisOrder.data.id}/cards/${secondAnalysisCard.id}`, {
    method: 'PATCH', body: { reasonIds: [analysisReasonId], note: 'INTERNAL-NOTES-CANARY-MERGED' },
  })).response.status, 200)
  assert.equal((await request(`/orders/${secondAnalysisOrder.data.id}/archive`, { method: 'POST', body: {} })).response.status, 200)

  const bulkPptx = await request('/export/bulk-maintenance', {
    method: 'POST', body: { format: 'pptx', area: 'North', reasonId: analysisReasonId },
  })
  assert.equal(bulkPptx.response.status, 200, JSON.stringify(bulkPptx.data))
  assert.match(bulkPptx.response.headers.get('content-type'), /presentationml/)
  assert.ok(bulkPptx.data.byteLength > 1000)
  const mergedPptx = await JSZip.loadAsync(Buffer.from(bulkPptx.data))
  const slidePaths = Object.keys(mergedPptx.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
  assert.equal(slidePaths.length, 4, 'cover + one merged North index + two machine slides')
  const areaIndexXml = await mergedPptx.file('ppt/slides/slide2.xml').async('string')
  const areaIndexRuns = [...areaIndexXml.matchAll(/<a:t>(.*?)<\/a:t>/g)].map((match) => match[1])
  assert.ok(areaIndexRuns.some((text) => text.includes('ANALYSIS-DONE')), JSON.stringify(areaIndexRuns))
  assert.ok(areaIndexRuns.some((text) => text.includes('ANALYSIS-MERGED')), JSON.stringify(areaIndexRuns))
  assert.ok(areaIndexRuns.includes('1') && areaIndexRuns.includes('2'), 'machine numbering continues across the merged area records')
  assert.ok(areaIndexRuns.includes('3') && areaIndexRuns.includes('4'), 'index page references point to the generated machine slides')
  const bulkPptxText = (await Promise.all(Object.values(mergedPptx.files)
    .filter((file) => !file.dir && file.name.startsWith('ppt/') && file.name.endsWith('.xml'))
    .map((file) => file.async('string')))).join('\n')
  assert.equal(bulkPptxText.includes('INTERNAL-NOTES-CANARY-DONE'), false)
  assert.equal(bulkPptxText.includes('INTERNAL-NOTES-CANARY-MERGED'), false)
  assert.ok(bulkPptxText.includes('الملخص الإحصائي للصيانة'))

  await new Promise((resolve) => setTimeout(resolve, 1050))
  const moveInternalReportMachineForm = new FormData()
  moveInternalReportMachineForm.append('file', new Blob([
    'Machine Code,Arabic Name,English Name,Region\nANALYSIS-MERGED,ماكينة من أمر آخر,Machine from another order,South\n',
  ], { type: 'text/csv' }), 'move-internal-report-machine.csv')
  const movedInternalReportMachine = await request('/machines/import?overwrite=true', {
    method: 'POST', form: moveInternalReportMachineForm,
  })
  assert.equal(movedInternalReportMachine.response.status, 200, JSON.stringify(movedInternalReportMachine.data))
  assert.equal(movedInternalReportMachine.data.updated, 1)

  const internalReportXlsx = await request('/analysis/export-internal-report', {
    method: 'POST', body: { format: 'xlsx', reasonId: analysisReasonId },
  })
  assert.equal(internalReportXlsx.response.status, 200, JSON.stringify(internalReportXlsx.data))
  assert.match(internalReportXlsx.response.headers.get('content-type'), /spreadsheetml/)
  const internalWorkbook = XLSX.read(Buffer.from(internalReportXlsx.data), { type: 'buffer' })
  const internalSheet = internalWorkbook.Sheets[internalWorkbook.SheetNames[0]]
  const internalRange = XLSX.utils.decode_range(internalSheet['!ref'])
  const internalCell = (row, column) => internalSheet[XLSX.utils.encode_cell({ r: row, c: column })]?.v ?? ''
  const internalAreaRows = []
  for (let row = internalRange.s.r; row <= internalRange.e.r; row += 1) {
    if (String(internalCell(row, 0)).startsWith('المنطقة: ')) internalAreaRows.push(row)
  }
  assert.deepEqual(internalAreaRows.map((row) => internalCell(row, 0)), ['المنطقة: North', 'المنطقة: South'])
  assert.equal(internalSheet['!merges'].length, 2)
  assert.ok(internalSheet['!merges'].every((merge) => merge.s.c === 0 && merge.e.c === 3 && merge.s.r === merge.e.r))
  const bilingualHeaders = [
    'كود الماكينة (Machine Code)', 'الاسم بالعربي (Arabic Name)',
    'الاسم بالإنجليزي (English Name)', 'ملاحظات (Notes)',
  ]
  for (const row of internalAreaRows) {
    assert.deepEqual([0, 1, 2, 3].map((column) => internalCell(row + 1, column)), bilingualHeaders)
  }
  const northHeaderIndex = internalAreaRows[0] + 1
  const southHeaderIndex = internalAreaRows[1] + 1
  assert.equal(internalCell(northHeaderIndex + 1, 0), 'ANALYSIS-DONE')
  assert.equal(internalCell(northHeaderIndex + 1, 3), 'INTERNAL-NOTES-CANARY-DONE')
  assert.ok([0, 1, 2, 3].every((column) => internalCell(internalAreaRows[1] - 1, column) === ''))
  assert.equal(internalCell(southHeaderIndex + 1, 0), 'ANALYSIS-MERGED')
  assert.equal(internalCell(southHeaderIndex + 1, 3), 'INTERNAL-NOTES-CANARY-MERGED')

  await new Promise((resolve) => setTimeout(resolve, 1050))
  const internalReportPdf = await request('/analysis/export-internal-report', {
    method: 'POST', body: { format: 'pdf', reasonId: analysisReasonId },
  })
  assert.equal(internalReportPdf.response.status, 200, JSON.stringify(internalReportPdf.data))
  assert.match(internalReportPdf.response.headers.get('content-type'), /application\/pdf/)
  assert.ok(Buffer.from(internalReportPdf.data).subarray(0, 5).equals(Buffer.from('%PDF-')))

  await new Promise((resolve) => setTimeout(resolve, 1050))
  const activeMasterMachines = (await request('/machines')).data
  const masterListXlsx = await request('/analysis/export-internal-report', {
    method: 'POST',
    body: { format: 'xlsx', fullList: true, area: 'No matching area', reasonId: 999999, from: 'bad-date', to: '1900-01-01' },
  })
  assert.equal(masterListXlsx.response.status, 200, JSON.stringify(masterListXlsx.data))
  assert.match(masterListXlsx.response.headers.get('content-disposition'), /Madar-Machine-Master-List\.xlsx/)
  const masterWorkbook = XLSX.read(Buffer.from(masterListXlsx.data), { type: 'buffer' })
  const masterArchive = await JSZip.loadAsync(Buffer.from(masterListXlsx.data))
  const masterWorksheetXml = await masterArchive.file('xl/worksheets/sheet1.xml').async('string')
  assert.match(masterWorksheetXml, /<sheetView[^>]*workbookViewId="0"/)
  assert.doesNotMatch(masterWorksheetXml, /<sheetView[^>]*rightToLeft="(?:1|true)"/i)
  const masterSheet = masterWorkbook.Sheets[masterWorkbook.SheetNames[0]]
  const masterRange = XLSX.utils.decode_range(masterSheet['!ref'])
  const masterCell = (row, column) => masterSheet[XLSX.utils.encode_cell({ r: row, c: column })]?.v ?? ''
  const masterAreaRows = []
  for (let row = masterRange.s.r; row <= masterRange.e.r; row += 1) {
    if (String(masterCell(row, 0)).startsWith('المنطقة: ')) masterAreaRows.push(row)
  }
  assert.ok(masterAreaRows.length > 1)
  assert.equal(masterSheet['!merges'].length, masterAreaRows.length)
  const allMasterDataRows = []
  const masterAreaOrder = masterAreaRows.map((row) => String(masterCell(row, 0)).slice('المنطقة: '.length))
  const arabicMasterCollator = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' })
  assert.deepEqual(masterAreaOrder, masterAreaOrder.slice().sort(arabicMasterCollator.compare))
  for (const [groupIndex, areaRow] of masterAreaRows.entries()) {
    assert.deepEqual([0, 1, 2, 3].map((column) => masterCell(areaRow + 1, column)), bilingualHeaders)
    const groupRows = []
    for (let row = areaRow + 2; row <= masterRange.e.r; row += 1) {
      const cells = [0, 1, 2, 3].map((column) => masterCell(row, column))
      if (cells.every((value) => value === '') || String(cells[0]).startsWith('المنطقة: ')) break
      assert.equal(cells.length, 4)
      groupRows.push(cells)
      allMasterDataRows.push(cells)
    }
    const sortedGroupRows = groupRows.slice().sort((left, right) => arabicMasterCollator.compare(left[1], right[1])
      || String(left[0]).localeCompare(String(right[0]), 'en', { numeric: true, sensitivity: 'base' }))
    assert.deepEqual(groupRows.map((row) => row[0]), sortedGroupRows.map((row) => row[0]))
    if (groupIndex > 0) {
      assert.ok([0, 1, 2, 3].every((column) => masterCell(areaRow - 1, column) === ''))
    }
  }
  assert.deepEqual(allMasterDataRows.map((row) => row[0]).sort(), activeMasterMachines.map((machine) => machine.code).sort())
  assert.equal(allMasterDataRows.find((row) => row[0] === 'ANALYSIS-MISSING')?.[3], '')
  assert.equal(allMasterDataRows.find((row) => row[0] === 'ANALYSIS-MERGED')?.[3], 'INTERNAL-NOTES-CANARY-MERGED')

  await new Promise((resolve) => setTimeout(resolve, 1050))
  const masterListPdf = await request('/analysis/export-internal-report', {
    method: 'POST', body: { format: 'pdf', fullList: true, reasonId: 999999, from: 'bad-date' },
  })
  assert.equal(masterListPdf.response.status, 200, JSON.stringify(masterListPdf.data))
  assert.match(masterListPdf.response.headers.get('content-type'), /application\/pdf/)
  assert.match(masterListPdf.response.headers.get('content-disposition'), /Madar-Machine-Master-List\.pdf/)
  assert.ok(Buffer.from(masterListPdf.data).subarray(0, 5).equals(Buffer.from('%PDF-')))

  await new Promise((resolve) => setTimeout(resolve, 1050))
  const bulkDocx = await request('/export/bulk-maintenance', {
    method: 'POST', body: { format: 'docx', area: 'North', reasonId: analysisReasonId },
  })
  assert.equal(bulkDocx.response.status, 200, JSON.stringify(bulkDocx.data))
  assert.match(bulkDocx.response.headers.get('content-type'), /wordprocessingml/)
  assert.ok(bulkDocx.data.byteLength > 1000)
  const bulkDocxZip = await JSZip.loadAsync(Buffer.from(bulkDocx.data))
  const bulkDocxText = await bulkDocxZip.file('word/document.xml').async('string')
  assert.ok(bulkDocxText.includes('الملخص الإحصائي للصيانة'))
  assert.ok(bulkDocxText.includes('حالات الإصلاحات الكهربائية'))

  const disposableClient = await request('/clients', { method: 'POST', body: { name: 'Soft deleted client' } })
  const removedClient = await request(`/clients/${disposableClient.data.id}`, { method: 'DELETE' })
  assert.equal(removedClient.response.status, 200)
  assert.ok(!(await request('/clients')).data.some((row) => row.id === disposableClient.data.id))
  const removedOrder = await request(`/orders/${order.id}`, { method: 'DELETE' })
  assert.equal(removedOrder.response.status, 200)
  assert.equal(removedOrder.data.storageRemoved, true)
  assert.equal(fs.existsSync(path.join(tempRoot, 'storage', ...order.folderPath.split('/'))), false)
  assert.equal((await request(`/orders/${order.id}`)).response.status, 404)
  const archivedOrderDelete = await request(`/orders/${reportOrder.data.id}`, { method: 'DELETE' })
  assert.equal(archivedOrderDelete.response.status, 200)
  assert.equal((await request(`/orders/${reportOrder.data.id}`)).response.status, 404)
  const orderDb = new Database(path.join(tempRoot, 'test.sqlite'), { readonly: true })
  assert.ok(orderDb.prepare('SELECT deleted_at FROM orders WHERE id=?').get(reportOrder.data.id).deleted_at)
  assert.ok(orderDb.prepare('SELECT deleted_at FROM orders WHERE id=?').get(order.id).deleted_at)
  orderDb.close()

  const operationsLogin = await request('/auth/login', {
    method: 'POST', body: { username: 'test-operations', password: 'operations-password-123' },
  })
  cookie = operationsLogin.response.headers.get('set-cookie').split(';')[0]
  assert.equal((await request('/audit')).response.status, 403)
  assert.equal((await request('/machines/wipe-catalog', { method: 'DELETE' })).response.status, 403)
  cookie = adminCookie
  const auditLog = await request('/audit?limit=200')
  assert.equal(auditLog.response.status, 200)
  const issueAudit = auditLog.data.find((row) => row.action === 'issue' && row.entity === 'material'
    && row.entity_id === String(purchase.data.items[0].materialId) && row.old_values?.stock === 3)
  assert.deepEqual(issueAudit.old_values, { stock: 3, subStock: 0 })
  assert.deepEqual(issueAudit.new_values, { stock: 1, subStock: 0.25 })

  const bulkMachineRows = [
    ['كود الماكينة', 'الاسم بالعربي', 'الاسم بالإنجليزي', 'المحافظة', 'المنطقة'],
    ...Array.from({ length: 1200 }, (_, index) => [
      `BULK-${String(index + 1).padStart(4, '0')}`, `ماكينة اختبار ${index + 1}`, `Bulk machine ${index + 1}`, 'اختبار', 'منطقة الاختبار',
    ]),
  ]
  const bulkMachineWorkbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(bulkMachineWorkbook, XLSX.utils.aoa_to_sheet(bulkMachineRows), 'الماكينات')
  const bulkMachineForm = new FormData()
  bulkMachineForm.append('deactivateMissing', 'true')
  bulkMachineForm.append('file', new Blob([XLSX.write(bulkMachineWorkbook, { bookType: 'xlsx', type: 'buffer' })], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }), 'bulk-machines.xlsx')
  const bulkMachineImport = await request('/machines/import', { method: 'POST', form: bulkMachineForm })
  assert.equal(bulkMachineImport.response.status, 200, JSON.stringify(bulkMachineImport.data))
  assert.deepEqual(bulkMachineImport.data, { added: 1200, updated: 0, deactivated: 7, skipped: 0 })
  const bulkMachineList = await request('/machines')
  assert.equal(bulkMachineList.data.length, 1200)
  assert.ok(bulkMachineList.data.some((machine) => machine.code === 'BULK-1200'))
  const preservedBulkMachine = bulkMachineList.data.find((machine) => machine.code === 'BULK-1200')

  const machineArchiveDir = path.join(tempRoot, 'storage', 'Uploads', 'Excel')
  await fs.promises.mkdir(machineArchiveDir, { recursive: true })
  await fs.promises.writeFile(path.join(machineArchiveDir, 'Machines_Import_manual.csv'), 'machine archive')
  await fs.promises.writeFile(path.join(machineArchiveDir, 'Inventory_Import_keep.csv'), 'inventory archive')
  await fs.promises.writeFile(path.join(machineArchiveDir, 'Users_Import_keep.xlsx'), 'user archive')
  const machineFolderMarker = path.join(tempRoot, 'storage', 'Machines', 'BULK-0001', 'keep.txt')
  await fs.promises.mkdir(path.dirname(machineFolderMarker), { recursive: true })
  await fs.promises.writeFile(machineFolderMarker, 'machine folder must be removed by catalog wipe')

  const replaceAllForm = new FormData()
  replaceAllForm.append('file', new Blob([
    'كود الماكينة,الاسم بالعربي\nBULK-1200,Replacement machine\nFINAL-ONLY,Final machine\n',
  ], { type: 'text/csv' }), 'replacement.csv')
  const replacedMachineImport = await request('/machines/import?replaceAll=true', { method: 'POST', form: replaceAllForm })
  assert.equal(replacedMachineImport.response.status, 400, JSON.stringify(replacedMachineImport.data))
  assert.equal((await request('/machines')).data.length, 1200)

  const rejectCatalogWipeAudit = new Database(path.join(tempRoot, 'test.sqlite'))
  rejectCatalogWipeAudit.exec(`CREATE TRIGGER reject_catalog_wipe_audit BEFORE INSERT ON audit_log
    WHEN NEW.action='wipe' AND NEW.entity='machine-catalog' BEGIN SELECT RAISE(ABORT,'isolated catalog wipe failure'); END`)
  rejectCatalogWipeAudit.close()
  const rolledBackCatalogWipe = await request('/machines/wipe-catalog', { method: 'DELETE' })
  assert.equal(rolledBackCatalogWipe.response.status, 409)
  assert.equal(fs.existsSync(machineFolderMarker), true)
  assert.equal(fs.existsSync(path.join(machineArchiveDir, 'Machines_Import_manual.csv')), true)
  assert.equal((await request('/machines')).data.length, 1200)
  const catalogRollbackDb = new Database(path.join(tempRoot, 'test.sqlite'))
  assert.equal(catalogRollbackDb.prepare('SELECT COUNT(*) AS count FROM filesystem_operations').get().count, 0)
  catalogRollbackDb.exec('DROP TRIGGER reject_catalog_wipe_audit')
  catalogRollbackDb.close()

  const wipedCatalog = await request('/machines/wipe-catalog', { method: 'DELETE' })
  assert.equal(wipedCatalog.response.status, 200, JSON.stringify(wipedCatalog.data))
  assert.equal(wipedCatalog.data.machineFoldersRemoved, true)
  assert.ok(wipedCatalog.data.machineStorageItemsRemoved >= 1200)
  assert.ok(wipedCatalog.data.sourceFilesRemoved >= 2)
  assert.equal(fs.existsSync(machineFolderMarker), false)
  assert.deepEqual(await fs.promises.readdir(path.join(tempRoot, 'storage', 'Machines')), [])
  assert.equal(fs.existsSync(path.join(machineArchiveDir, 'Machines_Import_manual.csv')), false)
  assert.equal(fs.existsSync(path.join(machineArchiveDir, 'Inventory_Import_keep.csv')), true)
  assert.equal(fs.existsSync(path.join(machineArchiveDir, 'Users_Import_keep.xlsx')), true)
  assert.equal((await fs.promises.readdir(machineArchiveDir)).some((name) => /^Machines_Import_.+\.(csv|xlsx)$/i.test(name)), false)
  assert.equal((await request('/machines')).data.length, 0)
  const deniedReplacementForm = new FormData()
  deniedReplacementForm.append('file', new Blob([
    'كود الماكينة,الاسم بالعربي\nBULK-1200,Replacement machine\n',
  ], { type: 'text/csv' }), 'unauthorized-replacement.csv')
  const deniedReplacement = await request('/machines/import?replacement=true', { method: 'POST', form: deniedReplacementForm })
  assert.equal(deniedReplacement.response.status, 400)

  const replacementForm = new FormData()
  replacementForm.append('file', new Blob([
    'كود الماكينة,الاسم بالعربي\nBULK-1200,Replacement machine\nFINAL-ONLY,Final machine\n',
  ], { type: 'text/csv' }), 'replacement.csv')
  const replacementImport = await request('/machines/import?replacement=true', {
    method: 'POST', form: replacementForm,
    headers: { 'X-Machine-Replacement-Token': wipedCatalog.data.replacementToken },
  })
  assert.equal(replacementImport.response.status, 200, JSON.stringify(replacementImport.data))
  assert.deepEqual(replacementImport.data, { added: 1, updated: 1, deactivated: 0, skipped: 0 })
  const replayedReplacementForm = new FormData()
  replayedReplacementForm.append('file', new Blob([
    'كود الماكينة,الاسم بالعربي\nREPLAYED,Replay machine\n',
  ], { type: 'text/csv' }), 'replayed-replacement.csv')
  const replayedReplacement = await request('/machines/import?replacement=true', {
    method: 'POST', form: replayedReplacementForm,
    headers: { 'X-Machine-Replacement-Token': wipedCatalog.data.replacementToken },
  })
  assert.equal(replayedReplacement.response.status, 403)
  const replacedMachineList = await request('/machines')
  assert.equal(replacedMachineList.data.length, 2)
  assert.equal(replacedMachineList.data.find((machine) => machine.code === 'BULK-1200').id, preservedBulkMachine.id)
  assert.ok(replacedMachineList.data.some((machine) => machine.code === 'FINAL-ONLY'))
  const archivedMachineRow = new Database(path.join(tempRoot, 'test.sqlite'), { readonly: true })
  try {
    const missingReplacementRow = archivedMachineRow.prepare('SELECT active,deleted_at FROM machines WHERE code=?').get('BULK-0001')
    assert.equal(missingReplacementRow.active, 0)
    assert.ok(missingReplacementRow.deleted_at)
    assert.equal(archivedMachineRow.prepare('SELECT deleted_at FROM machines WHERE code=?').get('BULK-1200').deleted_at, null)
    assert.ok(archivedMachineRow.prepare('SELECT 1 FROM audit_log WHERE action=? AND entity=?')
      .get('wipe', 'machine-catalog'))
    assert.ok(archivedMachineRow.prepare('SELECT 1 FROM audit_log WHERE action=? AND entity=?')
      .get('replacement-reactivate', 'machine'))
  } finally { archivedMachineRow.close() }

  await fs.promises.writeFile(path.join(machineArchiveDir, 'Machines_Import_manual.csv'), 'machine archive')
  const rejectMachineImportAudit = new Database(path.join(tempRoot, 'test.sqlite'))
  rejectMachineImportAudit.exec(`CREATE TRIGGER reject_machine_import_audit BEFORE INSERT ON audit_log
    WHEN NEW.action='archive-machine-import-delete' BEGIN SELECT RAISE(ABORT,'isolated import delete failure'); END`)
  rejectMachineImportAudit.close()
  const rolledBackMachineImportDelete = await request('/storage/files', {
    method: 'DELETE', body: { path: 'Uploads/Excel/Machines_Import_manual.csv' },
  })
  assert.equal(rolledBackMachineImportDelete.response.status, 409)
  assert.equal(fs.existsSync(path.join(machineArchiveDir, 'Machines_Import_manual.csv')), true)
  assert.equal((await request('/machines')).data.length, 2)
  const machineImportRollbackDb = new Database(path.join(tempRoot, 'test.sqlite'))
  assert.equal(machineImportRollbackDb.prepare('SELECT COUNT(*) AS count FROM filesystem_operations').get().count, 0)
  machineImportRollbackDb.exec('DROP TRIGGER reject_machine_import_audit')
  machineImportRollbackDb.close()
  const deletedMachineArchive = await request('/storage/files', {
    method: 'DELETE', body: { path: 'Uploads/Excel/Machines_Import_manual.csv' },
  })
  assert.equal(deletedMachineArchive.response.status, 200)
  assert.equal(deletedMachineArchive.data.archivedMachines, 2)
  assert.equal((await request('/machines')).data.length, 0)
  const machineDb = new Database(path.join(tempRoot, 'test.sqlite'), { readonly: true })
  assert.equal(machineDb.prepare('SELECT COUNT(*) AS count FROM machines WHERE deleted_at IS NULL').get().count, 0)
  assert.ok(machineDb.prepare('SELECT COUNT(*) AS count FROM machines WHERE deleted_at IS NOT NULL').get().count >= 1200)
  machineDb.close()

  const disableOperations = await request(`/users/${operationsUser.data.id}`, {
    method: 'PATCH', body: { active: false },
  })
  assert.equal(disableOperations.response.status, 200)
  assert.equal((await request('/auth/status', { authCookie: operationsCookie })).data.user, null)
  assert.equal((await request('/bootstrap', { authCookie: operationsCookie })).response.status, 401)
  const resetBatchPassword = await request(`/users/${importedUsers.data.find((item) => item.username === 'batch-worker').id}`, {
    method: 'PATCH', body: { password: 'batch-password-reset-123' },
  })
  assert.equal(resetBatchPassword.response.status, 200)
  const batchUserId = importedUsers.data.find((item) => item.username === 'batch-worker').id
  const deletedBatchUser = await request(`/users/${batchUserId}`, { method: 'DELETE' })
  assert.equal(deletedBatchUser.response.status, 200)
  assert.equal((await request('/users')).data.some((item) => item.id === batchUserId), false)
  const deletedUserDb = new Database(path.join(tempRoot, 'test.sqlite'), { readonly: true })
  assert.ok(deletedUserDb.prepare('SELECT deleted_at FROM users WHERE id=?').get(batchUserId).deleted_at)
  assert.equal(require('bcryptjs').compareSync('batch-password-reset-123', deletedUserDb.prepare('SELECT password_hash FROM users WHERE id=?').get(batchUserId).password_hash), true)
  deletedUserDb.close()
  assert.equal((await request('/workers')).response.status, 404)

  const restoreProofPath = path.join(tempRoot, 'storage', 'Areas', 'restore-check', 'proof.txt')
  await fs.promises.mkdir(path.dirname(restoreProofPath), { recursive: true })
  await fs.promises.writeFile(restoreProofPath, 'before restore')
  const legacyUserImportName = `Users_Import_legacy_1761000000000_${crypto.randomUUID()}.xlsx`
  const legacyUserImportPath = path.join(tempRoot, 'storage', 'Uploads', 'Excel', legacyUserImportName)
  const nestedLegacyUserImportName = `Users_Import_nested_1761000000000_${crypto.randomUUID()}.xls`
  const nestedLegacyUserImportPath = path.join(tempRoot, 'storage', 'Uploads', 'Excel', 'Nested', nestedLegacyUserImportName)
  await fs.promises.mkdir(path.dirname(legacyUserImportPath), { recursive: true })
  await fs.promises.mkdir(path.dirname(nestedLegacyUserImportPath), { recursive: true })
  await fs.promises.writeFile(legacyUserImportPath, 'isolated legacy fixture')
  await fs.promises.writeFile(nestedLegacyUserImportPath, 'isolated nested legacy fixture')
  const visibleExcelFiles = await request('/storage/files?path=Uploads%2FExcel')
  assert.equal(visibleExcelFiles.response.status, 200)
  assert.equal(visibleExcelFiles.data.some((entry) => entry.name === legacyUserImportName), false)
  assert.equal((await request(`/files?path=${encodeURIComponent(`Uploads/Excel/${legacyUserImportName}`)}`)).response.status, 404)
  const pendingOperationId = 'e9fb571c-a9f0-45bc-82bd-e33e462ae5da'
  const pendingOperationDb = new Database(path.join(tempRoot, 'test.sqlite'))
  pendingOperationDb.prepare(`INSERT INTO filesystem_operations(id,kind,state,payload)
    VALUES (?,'storage-delete','committed','[]')`).run(pendingOperationId)
  pendingOperationDb.close()
  const pendingOperationsStatus = await request('/operations/status')
  assert.equal(pendingOperationsStatus.data.ready, false)
  assert.equal(pendingOperationsStatus.data.pendingRecovery.total, 1)
  assert.equal((await request('/system/backups', { method: 'POST' })).response.status, 503)
  const clearPendingOperationDb = new Database(path.join(tempRoot, 'test.sqlite'))
  clearPendingOperationDb.prepare('DELETE FROM filesystem_operations WHERE id=?').run(pendingOperationId)
  clearPendingOperationDb.close()
  const downloadableBackup = await request('/backup/create', { method: 'POST' })
  assert.equal(downloadableBackup.response.status, 200)
  assert.match(downloadableBackup.response.headers.get('content-type'), /application\/zip/)
  assert.match(downloadableBackup.response.headers.get('content-disposition'), /madar_backup_\d{8}_\d{6}.*\.zip/i)
  const healthyBackupStatus = await request('/operations/status')
  assert.ok(healthyBackupStatus.data.backup.lastSuccessAt)
  assert.ok(healthyBackupStatus.data.backup.lastSuccessBytes > 0)
  assert.ok(Number.isInteger(healthyBackupStatus.data.freeSpaceMiB.backups))
  assert.equal(JSON.stringify(healthyBackupStatus.data).includes(tempRoot), false)
  const backupBytes = Buffer.from(downloadableBackup.data)
  const backupZip = await JSZip.loadAsync(backupBytes)
  assert.ok(backupZip.file('madar.sqlite'))
  assert.ok(backupZip.file('madar-backup-manifest.json'))
  assert.equal(backupZip.file(`storage/Uploads/Excel/${legacyUserImportName}`), null)
  assert.equal(backupZip.file(`storage/Uploads/Excel/Nested/${nestedLegacyUserImportName}`), null)
  assert.equal(await backupZip.file('storage/Areas/restore-check/proof.txt').async('string'), 'before restore')
  const backupManifest = JSON.parse(await backupZip.file('madar-backup-manifest.json').async('string'))
  assert.equal(backupManifest.applicationVersion, '1.0.0')
  assert.equal(backupManifest.schemaVersion, CURRENT_SCHEMA_VERSION)

  const unauthorizedRestoreForm = new FormData()
  unauthorizedRestoreForm.append('confirmation', 'RESTORE MADAR')
  unauthorizedRestoreForm.append('file', new Blob([backupBytes], { type: 'application/zip' }), 'unauthorized.zip')
  assert.equal((await request('/backup/restore', {
    method: 'POST', form: unauthorizedRestoreForm, authCookie: salesCookie,
  })).response.status, 403)

  const missingConfirmationForm = new FormData()
  missingConfirmationForm.append('file', new Blob([backupBytes], { type: 'application/zip' }), 'missing-confirmation.zip')
  assert.equal((await request('/backup/restore', { method: 'POST', form: missingConfirmationForm })).response.status, 400)

  await fs.promises.writeFile(restoreProofPath, 'changed after backup')
  const postBackupClient = await request('/clients', { method: 'POST', body: { name: 'Remove me by restore' } })
  assert.equal(postBackupClient.response.status, 201)
  await new Promise((resolve) => setTimeout(resolve, 1050))
  const restoreForm = new FormData()
  restoreForm.append('confirmation', 'RESTORE MADAR')
  restoreForm.append('file', new Blob([backupBytes], { type: 'application/zip' }), 'madar-integration-restore.zip')
  const restore = await request('/backup/restore', { method: 'POST', form: restoreForm })
  assert.equal(restore.response.status, 202, JSON.stringify(restore.data))
  assert.ok(restore.data.rollbackBackup)
  assert.ok(fs.existsSync(path.join(tempRoot, 'Backups', restore.data.rollbackBackup)))

  const serverBeforeRestore = child
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not exit after accepted restore.')), 30000)
    serverBeforeRestore.once('exit', (code) => {
      clearTimeout(timeout)
      if (code !== 0) reject(new Error(`Server exited unexpectedly after restore (${code}).`))
      else resolve()
    })
  })
  child = spawnTestServer()
  await waitForTestServer(child)
  assert.ok(!(await request('/clients')).data.some((row) => row.id === postBackupClient.data.id))
  assert.equal(await fs.promises.readFile(restoreProofPath, 'utf8'), 'before restore')
  const restoreAudit = (await request('/audit')).data.find((row) => row.action === 'restore' && row.entity === 'system-backup')
  assert.ok(restoreAudit)
  assert.equal(restoreAudit.new_values.restoredFrom, 'madar-integration-restore.zip')

  const revocationLogin = await request('/auth/login', {
    method: 'POST', body: { username: 'test-admin', password: 'test-password-123' }, authCookie: null,
  })
  assert.equal(revocationLogin.response.status, 200)
  const revocableCookie = revocationLogin.response.headers.get('set-cookie').split(';')[0]
  assert.equal((await request('/bootstrap', { authCookie: revocableCookie })).response.status, 200)
  assert.equal((await request('/auth/logout', { method: 'POST', authCookie: revocableCookie })).response.status, 200)
  assert.equal((await request('/bootstrap', { authCookie: revocableCookie })).response.status, 401)

  assert.equal((await request('/manufacturing/orders', { authCookie: null })).response.status, 401)
  assert.equal((await request('/manufacturing/orders', { authCookie: salesCookie, method: 'POST', body: {
    clientId: client.data.id, productName: 'Laser cut acrylic sign', machineType: 'laser',
  } })).response.status, 403)
  const manufacturingOrder = await request('/manufacturing/orders', { authCookie: adminCookie, method: 'POST', body: {
    clientId: client.data.id, productName: 'Laser cut acrylic sign', description: 'Isolated manufacturing workflow test',
    machineType: 'laser', targetDeliveryDate: '2026-10-25', technicianIds: [maintenanceEmployee.data.id],
  } })
  assert.equal(manufacturingOrder.response.status, 201, manufacturingOrder.data.error)
  assert.match(manufacturingOrder.data.order_code, /^MFG-/)
  assert.equal(manufacturingOrder.data.status, 'in_production')
  const manufacturingBootstrap = await request('/bootstrap')
  assert.ok(manufacturingBootstrap.data.manufacturingOrders.some((row) => row.id === manufacturingOrder.data.id
    && row.client_name === client.data.name))
  assert.equal(manufacturingBootstrap.data.stats.activeManufacturingOrders, 1)
  assert.equal(manufacturingBootstrap.data.stats.readyManufacturingOrders, 0)
  const availableManufacturingOffcut = (await request('/warehouse/offcuts?status=available', { authCookie: adminCookie })).data
    .find((item) => item.id === countOffcut.data.id)
  assert.ok(availableManufacturingOffcut)
  const manufacturingIssue = await request(`/manufacturing/orders/${manufacturingOrder.data.id}/materials`, {
    authCookie: adminCookie, method: 'POST', body: { items: [
      { sourceWarehouse: 'main', materialId: material.data.id, quantity: 1 },
      { sourceWarehouse: 'offcut', offcutId: availableManufacturingOffcut.id, quantity: 0.1 },
    ] },
  })
  assert.equal(manufacturingIssue.response.status, 201, manufacturingIssue.data.error)
  assert.equal(manufacturingIssue.data.materialsUsed.length, 2)
  assert.equal((await request('/materials', { authCookie: adminCookie })).data.find((item) => item.id === material.data.id).stock, 2)
  const manufacturingMovement = (await request('/inventory/movements')).data.find((movement) =>
    movement.source_type === 'manufacturing_order' && movement.source_id === String(manufacturingOrder.data.id))
  assert.equal(manufacturingMovement.order_code, manufacturingOrder.data.order_code)
  assert.equal(manufacturingMovement.issue_classification, 'order')
  const invalidDesignUpload = new FormData()
  invalidDesignUpload.append('file', new Blob(['not a design'], { type: 'text/plain' }), 'malware.exe')
  assert.equal((await request(`/manufacturing/orders/${manufacturingOrder.data.id}/designs`, {
    authCookie: adminCookie, method: 'POST', form: invalidDesignUpload,
  })).response.status, 400)
  const designUpload = new FormData()
  const designBytes = Buffer.from('%PDF-1.7 test vector design')
  designUpload.append('file', new Blob([designBytes], { type: 'application/pdf' }), 'laser-layout.pdf')
  const attachedDesign = await request(`/manufacturing/orders/${manufacturingOrder.data.id}/designs`, {
    authCookie: adminCookie, method: 'POST', form: designUpload,
  })
  assert.equal(attachedDesign.response.status, 201, attachedDesign.data.error)
  assert.match(attachedDesign.data.downloadUrl, /^\/api\/manufacturing\/designs\/\d+\/download$/)
  const designDownload = await request(attachedDesign.data.downloadUrl.replace('/api', ''), { authCookie: adminCookie })
  assert.equal(designDownload.response.status, 200)
  assert.deepEqual(Buffer.from(designDownload.data), designBytes)
  const manufacturingReady = await request(`/manufacturing/orders/${manufacturingOrder.data.id}/ready`, { authCookie: adminCookie, method: 'POST', body: {
    offcuts: [{ materialId: material.data.id, name: 'Acrylic production remnant', dimensions: '25x40 cm', quantity: 0.2, unit: 'لوح' }],
  } })
  assert.equal(manufacturingReady.response.status, 200, manufacturingReady.data.error)
  assert.equal(manufacturingReady.data.status, 'ready')
  assert.equal((await request('/warehouse/offcuts', { authCookie: adminCookie })).data.some((row) => row.name === 'Acrylic production remnant'), true)
  assert.ok(manufacturingReady.data.offcuts[0].costCents > 0)
  const manufacturingDelivered = await request(`/manufacturing/orders/${manufacturingOrder.data.id}/deliver`, {
    method: 'POST', body: { invoiceId: sale.data.id }, authCookie: adminCookie,
  })
  assert.equal(manufacturingDelivered.response.status, 200, manufacturingDelivered.data.error)
  assert.equal(manufacturingDelivered.data.status, 'delivered_archived')
  assert.equal((await request('/manufacturing/orders?status=delivered_archived', { authCookie: adminCookie })).data.some((row) => row.id === manufacturingOrder.data.id), true)

  const statementBeforeAutoInvoice = await request(`/clients/${client.data.id}/statement`, { authCookie: adminCookie })
  assert.equal(statementBeforeAutoInvoice.response.status, 200)
  const autoInvoiceOrder = await request('/manufacturing/orders', { authCookie: adminCookie, method: 'POST', body: {
    clientId: client.data.id, productName: 'Auto-invoiced workshop product', machineType: 'manual', saleAmount: 250,
  } })
  assert.equal(autoInvoiceOrder.response.status, 201, autoInvoiceOrder.data.error)
  assert.equal(autoInvoiceOrder.data.sale_amount_cents, 25000)
  const workshopMainIssue = await request('/inventory/issue', { authCookie: adminCookie, method: 'POST', body: {
    materialId: material.data.id, quantity: 1.5, warehouse: 'main', classification: 'order',
    orderId: autoInvoiceOrder.data.id, orderType: 'manufacturing',
  } })
  assert.equal(workshopMainIssue.response.status, 200, workshopMainIssue.data.error)
  assert.equal(workshopMainIssue.data.manufacturingOrderId, autoInvoiceOrder.data.id)
  assert.equal(workshopMainIssue.data.orderType, 'manufacturing')
  const workshopSubIssue = await request('/inventory/issue', { authCookie: adminCookie, method: 'POST', body: {
    materialId: material.data.id, quantity: 0.25, warehouse: 'sub', classification: 'order',
    orderId: autoInvoiceOrder.data.id, orderType: 'manufacturing',
  } })
  assert.equal(workshopSubIssue.response.status, 200, workshopSubIssue.data.error)
  const workshopOrderAfterIssue = await request(`/manufacturing/orders/${autoInvoiceOrder.data.id}`, { authCookie: adminCookie })
  assert.equal(workshopOrderAfterIssue.data.materials_used.length, 2)
  assert.ok(workshopOrderAfterIssue.data.materials_used.every((row) => row.costCents > 0 && row.journalEntryId))
  const workshopIssueMovements = (await request('/inventory/movements', { authCookie: adminCookie })).data.filter((movement) =>
    movement.source_type === 'manufacturing_order' && movement.source_id === String(autoInvoiceOrder.data.id))
  assert.ok(workshopIssueMovements.some((movement) => movement.kind === 'issue' && movement.reference === autoInvoiceOrder.data.order_code
    && movement.order_code === autoInvoiceOrder.data.order_code
    && movement.issue_classification === 'order'))
  assert.ok(workshopIssueMovements.some((movement) => movement.kind === 'adjustment' && movement.order_code === autoInvoiceOrder.data.order_code))
  assert.equal((await request(`/manufacturing/orders/${autoInvoiceOrder.data.id}/ready`, {
    authCookie: adminCookie, method: 'POST', body: { offcuts: [] },
  })).response.status, 200)
  const autoInvoicedDelivery = await request(`/manufacturing/orders/${autoInvoiceOrder.data.id}/deliver`, {
    authCookie: adminCookie, method: 'POST', body: { createInvoice: true },
  })
  assert.equal(autoInvoicedDelivery.response.status, 200, autoInvoicedDelivery.data.error)
  assert.equal(autoInvoicedDelivery.data.invoiceAutoCreated, true)
  assert.equal(autoInvoicedDelivery.data.invoiceTotal, 250)
  assert.ok(autoInvoicedDelivery.data.cogsCents > 0)
  const workshopSalesInvoiceView = await request('/sales/invoices', { authCookie: salesCookie })
  assert.equal(workshopSalesInvoiceView.data.find((row) => row.id === autoInvoicedDelivery.data.salesInvoiceId).order_code,
    autoInvoiceOrder.data.order_code)
  const financeInvoiceView = await request('/finance/dashboard', { authCookie: adminCookie })
  assert.equal(financeInvoiceView.data.invoices.find((row) => row.id === autoInvoicedDelivery.data.salesInvoiceId).order_code,
    autoInvoiceOrder.data.order_code)
  const autoInvoiceDb = new Database(path.join(tempRoot, 'test.sqlite'), { readonly: true })
  try {
    const invoice = autoInvoiceDb.prepare('SELECT kind,client_id,total,paid_total,remaining,payment_status,manufacturing_order_id FROM invoices WHERE id=?')
      .get(autoInvoicedDelivery.data.salesInvoiceId)
    assert.deepEqual(invoice, { kind: 'sales', client_id: client.data.id, total: 250, paid_total: 0,
      remaining: 250, payment_status: 'unpaid', manufacturing_order_id: autoInvoiceOrder.data.id })
  } finally { autoInvoiceDb.close() }
  const statementBeforeAging = await request(`/clients/${client.data.id}/statement`, { authCookie: adminCookie })
  assert.equal(statementBeforeAging.data.total_billed, statementBeforeAutoInvoice.data.total_billed + 250)
  assert.equal(statementBeforeAging.data.total_paid, statementBeforeAutoInvoice.data.total_paid)
  assert.equal(statementBeforeAging.data.outstanding_balance, statementBeforeAutoInvoice.data.outstanding_balance + 250)
  const ageInvoiceDb = new Database(path.join(tempRoot, 'test.sqlite'))
  ageInvoiceDb.prepare("UPDATE invoices SET created_at=datetime('now','-61 days') WHERE id=?")
    .run(autoInvoicedDelivery.data.salesInvoiceId)
  ageInvoiceDb.close()
  const overdueStatement = await request(`/clients/${client.data.id}/statement`, { authCookie: adminCookie })
  assert.equal(overdueStatement.data.overdue_60_days, true)
  assert.ok(overdueStatement.data.overdue_invoices.some((invoice) => invoice.id === autoInvoicedDelivery.data.salesInvoiceId))
})
