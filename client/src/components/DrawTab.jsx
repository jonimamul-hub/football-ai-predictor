import { useState } from 'react'
import SecNav         from './SecNav'
import Analysis       from './Analysis'
import Recommendation from './Recommendation'
import History        from './History'
import DataConfig     from './DataConfig'

const DRAW_PAUSED = true

export default function DrawTab({ leagues = [], searchDate, searchTz }) {
  const [sec, setSec] = useState('history')
  const sections = ['analysis', 'recommendation', 'history', 'data config']

  return (
    <div>
      {DRAW_PAUSED && (
        <div className="draw-paused-banner">
          ⏸ Draw System is paused — Analysis and Recommendations are disabled.
          History and Data Config remain accessible.
        </div>
      )}
      <SecNav sections={sections} active={sec} setActive={setSec} />

      {sec === 'analysis' && (
        DRAW_PAUSED
          ? <div className="paused-placeholder">⏸ Draw Analysis is currently paused.</div>
          : <Analysis type="draw" searchDate={searchDate} />
      )}
      {sec === 'recommendation' && (
        DRAW_PAUSED
          ? <div className="paused-placeholder">⏸ Draw Recommendations are currently paused.</div>
          : <Recommendation type="draw" leagues={leagues} searchDate={searchDate} searchTz={searchTz} />
      )}
      {sec === 'history'     && <History    type="draw" />}
      {sec === 'data config' && <DataConfig type="draw" />}
    </div>
  )
}
