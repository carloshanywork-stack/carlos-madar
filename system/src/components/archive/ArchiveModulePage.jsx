import { useSearchParams } from 'react-router-dom'
import { Activity, Archive } from 'lucide-react'
import DomainTabs from '../DomainTabs'

const tabs = [
  { id: 'ledger', label: 'سجل الأرشيف', icon: Archive },
  { id: 'analytics', label: 'تحليل الأرشيف والتقارير', icon: Activity },
]

export default function ArchiveModulePage({ ledger, analytics }) {
  const [params, setParams] = useSearchParams()
  const activeTab = params.get('tab') === 'analytics' ? 'analytics' : 'ledger'
  const selectTab = (tab) => setParams(tab === 'ledger' ? {} : { tab }, { replace: true })
  return <div className="page-enter">
    <DomainTabs tabs={tabs} value={activeTab} onChange={selectTab} label="الأرشيف والتحليل"/>
    {activeTab === 'analytics' ? analytics : ledger}
  </div>
}
