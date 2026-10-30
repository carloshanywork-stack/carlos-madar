import { useSearchParams } from 'react-router-dom'
import { BriefcaseBusiness, BookOpenCheck } from 'lucide-react'
import DomainTabs from '../DomainTabs'

const tabs = [
  { id: 'accounting', label: 'المحاسبة والرواتب', icon: BookOpenCheck },
  { id: 'staff', label: 'الفريق والدوام', icon: BriefcaseBusiness },
]

export default function AccountingStaffModulePage({ accounting, staff }) {
  const [params, setParams] = useSearchParams()
  const activeTab = params.get('tab') === 'staff' ? 'staff' : 'accounting'
  const selectTab = (tab) => setParams(tab === 'accounting' ? {} : { tab }, { replace: true })
  return <div className="page-enter">
    <DomainTabs tabs={tabs} value={activeTab} onChange={selectTab} label="المحاسبة والموارد البشرية"/>
    {activeTab === 'staff' ? staff : accounting}
  </div>
}
