function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

function registerStaffRoutes(api, { db, requireAuth, allowRoles, sendError }) {
  const admin = [requireAuth, allowRoles('admin')]

  api.get('/staff', ...admin, (req, res) => {
    const includeInactive = req.query.includeInactive === 'true'
    const employees = db.prepare(`SELECT e.id,e.name,e.department,e.phone,e.job_title,e.monthly_salary_cents,
        e.base_salary,e.standard_daily_hours,e.standard_monthly_days,e.active,e.is_active,e.can_login,
        e.login_username,e.role AS login_role,u.id AS user_id,u.username,u.active AS user_active,u.deleted_at AS user_deleted_at,
        (SELECT COUNT(*) FROM employee_tool_custody c WHERE c.employee_id=e.id AND c.return_status='issued') AS outstanding_tool_count
      FROM employees e LEFT JOIN users u ON u.employee_id=e.id
      WHERE e.deleted_at IS NULL ${includeInactive ? '' : 'AND e.active=1'} ORDER BY e.name COLLATE NOCASE`).all()
    res.json(employees.map((employee) => ({
      id: employee.id, name: employee.name, department: employee.department, phone: employee.phone,
      jobTitle: employee.job_title || '', monthlySalaryCents: Number(employee.monthly_salary_cents || 0),
      baseSalaryCents: Number(employee.base_salary || 0), standardDailyHours: employee.standard_daily_hours,
      standardMonthlyDays: employee.standard_monthly_days, active: Boolean(employee.active),
      isActive: Boolean(employee.is_active), canLogin: Boolean(employee.can_login),
      username: employee.username || null, userActive: employee.user_active == null ? null : Boolean(employee.user_active),
      userDeleted: Boolean(employee.user_deleted_at), loginRole: employee.login_role || null,
      outstandingToolCount: Number(employee.outstanding_tool_count || 0),
    })))
  })

  api.get('/staff/attendance', ...admin, (req, res) => {
    const date = String(req.query.date || '')
    if (!validDate(date)) return sendError(res, 400, 'أدخل تاريخ حضور صحيحًا بصيغة YYYY-MM-DD.')
    const rows = db.prepare(`SELECT e.id AS employee_id,e.name,e.department,e.job_title,
        a.id AS attendance_id,a.status,a.overtime_minutes,a.holiday_overtime_minutes,a.notes
      FROM employees e LEFT JOIN employee_daily_attendance a
        ON a.employee_id=e.id AND a.attendance_date=?
      WHERE e.active=1 AND e.deleted_at IS NULL ORDER BY e.name COLLATE NOCASE`).all(date)
    res.json({ date, employees: rows })
  })

  api.post('/staff/attendance/mark-all-present', ...admin, (req, res) => {
    const date = String(req.body?.date || '')
    if (!validDate(date)) return sendError(res, 400, 'أدخل تاريخ حضور صحيحًا بصيغة YYYY-MM-DD.')
    try {
      const result = db.transaction(() => {
        const employees = db.prepare('SELECT id FROM employees WHERE active=1 AND deleted_at IS NULL').all()
        const upsert = db.prepare(`INSERT INTO employee_daily_attendance(employee_id,attendance_date,status,marked_by)
          VALUES (?,?,'present',?) ON CONFLICT(employee_id,attendance_date) DO UPDATE SET
            status='present',marked_by=excluded.marked_by,updated_at=CURRENT_TIMESTAMP`)
        for (const employee of employees) upsert.run(employee.id, date, req.user.id)
        db.prepare('INSERT INTO audit_log(user_id,action,entity,entity_id,details,new_values) VALUES (?,?,?,?,?,?)')
          .run(req.user.id, 'mark-all-present', 'employee_attendance', date, `count=${employees.length}`,
            JSON.stringify({ date, employeeIds: employees.map(({ id }) => id), status: 'present' }))
        return employees.length
      })()
      res.json({ date, markedCount: result })
    } catch (error) { return sendError(res, 400, error.message) }
  })

  api.put('/staff/attendance/:date', ...admin, (req, res) => {
    const { date } = req.params
    const entries = req.body?.entries
    if (!validDate(date) || !Array.isArray(entries) || entries.length < 1 || entries.length > 1000) {
      return sendError(res, 400, 'بيانات الحضور أو التاريخ غير صالحة.')
    }
    const employeeIds = entries.map((entry) => Number(entry?.employeeId))
    if (employeeIds.some((id) => !Number.isSafeInteger(id) || id < 1) || new Set(employeeIds).size !== employeeIds.length) {
      return sendError(res, 400, 'قائمة الموظفين غير صالحة أو تحتوي على تكرار.')
    }
    for (const entry of entries) {
      const overtime = Number(entry.overtimeMinutes || 0)
      const holidayOvertime = Number(entry.holidayOvertimeMinutes || 0)
      if (!['present', 'absent', 'leave', 'holiday'].includes(entry.status)
        || !Number.isSafeInteger(overtime) || overtime < 0 || overtime > 1440
        || !Number.isSafeInteger(holidayOvertime) || holidayOvertime < 0 || holidayOvertime > 1440
        || String(entry.notes || '').length > 500) {
        return sendError(res, 400, 'تحقق من حالة الحضور والساعات الإضافية والملاحظات.')
      }
    }
    try {
      const save = db.transaction(() => {
        const upsert = db.prepare(`INSERT INTO employee_daily_attendance
          (employee_id,attendance_date,status,overtime_minutes,holiday_overtime_minutes,notes,marked_by)
          SELECT ?,?,?,?,?,?,? WHERE EXISTS (
            SELECT 1 FROM employees WHERE id=? AND active=1 AND deleted_at IS NULL
          )
          ON CONFLICT(employee_id,attendance_date) DO UPDATE SET status=excluded.status,
            overtime_minutes=excluded.overtime_minutes,holiday_overtime_minutes=excluded.holiday_overtime_minutes,
            notes=excluded.notes,marked_by=excluded.marked_by,updated_at=CURRENT_TIMESTAMP`)
        for (let index = 0; index < entries.length; index += 1) {
          const entry = entries[index]
          const employeeId = employeeIds[index]
          const result = upsert.run(employeeId, date, entry.status, Number(entry.overtimeMinutes || 0),
            Number(entry.holidayOvertimeMinutes || 0), String(entry.notes || '').trim(), req.user.id, employeeId)
          if (result.changes !== 1) throw new Error(`الموظف ${employeeId} غير موجود أو غير نشط.`)
        }
        db.prepare('INSERT INTO audit_log(user_id,action,entity,entity_id,details,new_values) VALUES (?,?,?,?,?,?)')
          .run(req.user.id, 'update-daily-attendance', 'employee_attendance', date, `count=${entries.length}`,
            JSON.stringify(entries.map((entry, index) => ({ ...entry, employeeId: employeeIds[index] }))))
        return db.prepare(`SELECT a.*,e.name AS employee_name FROM employee_daily_attendance a
          JOIN employees e ON e.id=a.employee_id WHERE a.attendance_date=? ORDER BY e.name COLLATE NOCASE`).all(date)
      })()
      res.json({ date, entries: save })
    } catch (error) { return sendError(res, 400, error.message) }
  })

  api.get('/staff/:employeeId/tools', ...admin, (req, res) => {
    const employeeId = Number(req.params.employeeId)
    if (!Number.isSafeInteger(employeeId) || employeeId < 1) return sendError(res, 400, 'رقم الموظف غير صالح.')
    const employee = db.prepare('SELECT id FROM employees WHERE id=?').get(employeeId)
    if (!employee) return sendError(res, 404, 'الموظف غير موجود.')
    res.json(db.prepare('SELECT * FROM employee_tool_custody WHERE employee_id=? ORDER BY issued_at DESC,id DESC').all(employeeId))
  })

  api.post('/staff/:employeeId/tools', ...admin, (req, res) => {
    const employeeId = Number(req.params.employeeId)
    const toolName = String(req.body?.toolName || '').trim()
    const serialNumber = String(req.body?.serialNumber || '').trim()
    const notes = String(req.body?.notes || '').trim()
    if (!Number.isSafeInteger(employeeId) || employeeId < 1 || !toolName || toolName.length > 150
      || serialNumber.length > 120 || notes.length > 500) return sendError(res, 400, 'بيانات العهدة غير صالحة.')
    try {
      const issued = db.transaction(() => {
        const employee = db.prepare('SELECT id,active FROM employees WHERE id=? AND deleted_at IS NULL').get(employeeId)
        if (!employee || !employee.active) throw new Error('الموظف غير موجود أو غير نشط.')
        const result = db.prepare(`INSERT INTO employee_tool_custody(employee_id,tool_name,serial_number,issued_by,notes)
          VALUES (?,?,?,?,?)`).run(employeeId, toolName, serialNumber, req.user.id, notes)
        const row = db.prepare('SELECT * FROM employee_tool_custody WHERE id=?').get(result.lastInsertRowid)
        db.prepare('INSERT INTO audit_log(user_id,action,entity,entity_id,details,new_values) VALUES (?,?,?,?,?,?)')
          .run(req.user.id, 'issue-tool', 'employee_tool_custody', row.id, `employee=${employeeId}`,
            JSON.stringify(row))
        return row
      })()
      res.status(201).json(issued)
    } catch (error) { return sendError(res, /UNIQUE/.test(error.message) ? 409 : 400, error.message) }
  })

  api.post('/staff/tools/:toolId/return', ...admin, (req, res) => {
    const toolId = Number(req.params.toolId)
    if (!Number.isSafeInteger(toolId) || toolId < 1) return sendError(res, 400, 'رقم العهدة غير صالح.')
    try {
      const returned = db.transaction(() => {
        const row = db.prepare('SELECT * FROM employee_tool_custody WHERE id=?').get(toolId)
        if (!row) throw Object.assign(new Error('العهدة غير موجودة.'), { status: 404 })
        if (row.return_status !== 'issued') throw Object.assign(new Error('تم إغلاق هذه العهدة مسبقًا.'), { status: 409 })
        db.prepare(`UPDATE employee_tool_custody SET return_status='returned',returned_at=CURRENT_TIMESTAMP,
          returned_by=? WHERE id=? AND return_status='issued'`).run(req.user.id, toolId)
        const updated = db.prepare('SELECT * FROM employee_tool_custody WHERE id=?').get(toolId)
        db.prepare('INSERT INTO audit_log(user_id,action,entity,entity_id,details,old_values,new_values) VALUES (?,?,?,?,?,?,?)')
          .run(req.user.id, 'return-tool', 'employee_tool_custody', toolId, `employee=${row.employee_id}`,
            JSON.stringify(row), JSON.stringify(updated))
        return updated
      })()
      res.json(returned)
    } catch (error) { return sendError(res, error.status || 400, error.message) }
  })
}

module.exports = { registerStaffRoutes, validDate }
