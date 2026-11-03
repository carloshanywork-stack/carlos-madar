import { useMemo } from 'react';
import { useApi } from '../../lib/useApi.js';
import Checkbox from './Checkbox.jsx';
import Alert from './Alert.jsx';

export default function EmployeeCheckboxList({ department, selectedIds, onChange, title }) {
  const { data, loading, error } = useApi(`/api/employees?department=${encodeURIComponent(department)}`);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const employees = data ?? [];

  function toggle(employeeId, checked) {
    onChange(checked ? [...selectedIds, employeeId] : selectedIds.filter((id) => id !== employeeId));
  }

  return (
    <div className="madar-employee-picker">
      {title && <div className="madar-employee-picker-title">{title}</div>}
      {loading && <div className="madar-small madar-muted">جارٍ تحميل قائمة العاملين…</div>}
      {error && <Alert tone="error">{error}</Alert>}
      {!loading && !error && employees.length === 0 && (
        <div className="madar-picker-empty">لا يوجد موظفون نشطون ضمن قسم {department === 'Maintenance' ? 'الصيانة' : 'الورشة'}.</div>
      )}
      <div className="madar-employee-grid">
        {employees.map((employee) => (
          <Checkbox
            key={employee.id}
            checked={selected.has(employee.id)}
            onChange={(event) => toggle(employee.id, event.target.checked)}
            title={employee.name}
            description={employee.job_title || employee.department}
          />
        ))}
      </div>
    </div>
  );
}
