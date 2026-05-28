import { useState } from 'react'
import SecNav         from './SecNav'
import Analysis       from './Analysis'
import Recommendation from './Recommendation'
import History        from './History'
import DataConfig     from './DataConfig'

export default function DrawTab({ leagues = [], searchDate, searchTz }) {
  const [sec, setSec] = useState('analysis')
  const sections = ['analysis', 'recommendation', 'history', 'data config']

  return (
    <div>
      <SecNav sections={sections} active={sec} setActive={setSec} />
      {sec === 'analysis'       && <Analysis      type="draw" searchDate={searchDate} />}
      {sec === 'recommendation' && <Recommendation type="draw" leagues={leagues} searchDate={searchDate} searchTz={searchTz} />}
      {sec === 'history'        && <History        type="draw" />}
      {sec === 'data config'    && <DataConfig     type="draw" />}
    </div>
  )
}
