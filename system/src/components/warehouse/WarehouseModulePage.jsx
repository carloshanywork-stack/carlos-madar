import { useSearchParams } from 'react-router-dom'
import { Boxes, Package } from 'lucide-react'
import DomainTabs from '../DomainTabs'

const tabs = [
  { id: 'main', label: 'المخزن الرئيسي والمشتريات', icon: Package },
  { id: 'offcuts', label: 'المخزن الجانبي للخامات', icon: Boxes },
]

export default function WarehouseModulePage({ mainWarehouse, offcutsWarehouse }) {
  const [params, setParams] = useSearchParams()
  const activeTab = params.get('tab') === 'offcuts' ? 'offcuts' : 'main'
  const selectTab = (tab) => setParams(tab === 'main' ? {} : { tab }, { replace: true })
  return <div className="page-enter">
    <DomainTabs tabs={tabs} value={activeTab} onChange={selectTab} label="مخازن المواد"/>
    {activeTab === 'main' ? mainWarehouse : offcutsWarehouse}
  </div>
}
