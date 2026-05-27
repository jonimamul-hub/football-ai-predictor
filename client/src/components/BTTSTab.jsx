import { useState } from 'react'
import SecNav       from './SecNav'
import Analysis     from './Analysis'
import Recommendation from './Recommendation'
import History      from './History'
import DataConfig   from './DataConfig'

export default function BTTSTab({ leagues = [], searchDate, searchTz }) {
  const [sec, setSec] = useState('analysis')
  const sections = ['analysis', 'recommendation', 'history', 'data config']

  return (
    <div>
      <SecNav sections={sections} active={sec} setActive={setSec} />
      {sec === 'analysis'       && <Analysis      type="btts" />}
      {sec === 'recommendation' && <Recommendation type="btts" leagues={leagues} searchDate={searchDate} searchTz={searchTz} />}
      {sec === 'history'        && <History        type="btts" />}
      {sec === 'data config'    && <DataConfig     type="btts" />}
    </div>
  )
}
