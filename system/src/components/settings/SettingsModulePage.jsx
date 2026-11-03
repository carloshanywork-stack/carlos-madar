import { useSearchParams } from 'react-router-dom'
import { Settings, Users } from 'lucide-react'
import DomainTabs from '../DomainTabs'

const tabs = [
  { id: 'settings', label: 'إعدادات النظام', icon: Settings },
  { id: 'users', label: 'المستخدمون والصلاحيات', icon: Users },
]

export default function SettingsModulePage({ settings, users }) {
  const [params, setParams] = useSearchParams()
  const activeTab = params.get('tab') === 'users' ? 'users' : 'settings'
  const selectTab = (tab) => setParams(tab === 'settings' ? {} : { tab }, { replace: true })
  return <div className="page-enter">
    <DomainTabs tabs={tabs} value={activeTab} onChange={selectTab} label="إعدادات النظام"/>
    {activeTab === 'users' ? users : settings}
  </div>
}
