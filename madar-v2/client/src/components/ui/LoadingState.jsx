export default function LoadingState({ label = 'جارٍ تحميل البيانات' }) {
  return <div className="madar-loading"><div><div className="madar-spinner" /><p className="madar-loading-label">{label}</p></div></div>;
}
