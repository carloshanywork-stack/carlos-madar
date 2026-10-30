import { useSearchParams } from 'react-router-dom'
import { ClipboardList, HardDrive } from 'lucide-react'
import DomainTabs from '../DomainTabs'
import MachinesPage from '../machines/MachinesPage'
import OrdersPage from '../orders/OrdersPage'

const tabs = [
  { id: 'orders', label: 'أوامر الصيانة', icon: ClipboardList },
  { id: 'machines', label: 'قاعدة ماكينات المواقع', icon: HardDrive },
]

export default function MaintenanceModulePage({ data, user, search, setSearch, onCreate, onOpen, onEdit, onDelete, notify, formatMoney,
  onMachineAdd, onRefresh, apiClient }) {
  const [params, setParams] = useSearchParams()
  const activeTab = params.get('tab') === 'machines' ? 'machines' : 'orders'
  const selectTab = (tab) => setParams(tab === 'orders' ? {} : { tab }, { replace: true })

  return <div className="page-enter">
    <DomainTabs tabs={tabs} value={activeTab} onChange={selectTab} label="أقسام الصيانة"/>
    {activeTab === 'machines' ? <MachinesPage data={data} search={search} setSearch={setSearch} onAdd={onMachineAdd}
      onRefresh={onRefresh} notify={notify} apiClient={apiClient}/> : <OrdersPage data={data} user={user} search={search}
      setSearch={setSearch} onCreate={onCreate} onOpen={onOpen} onEdit={onEdit} onDelete={onDelete}
      notify={notify} formatMoney={formatMoney} orderType="maintenance"/>}
  </div>
}
