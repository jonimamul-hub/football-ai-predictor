import { useState } from 'react'
import SecNav         from './SecNav'
import Recommendation from './Recommendation'
import History        from './History'
import DataConfig     from './DataConfig'

export default function DrawTab({ leagues = [] }) {
  const [sec, setSec] = useState('recommendation')
  const sections = ['recommendation', 'history', 'data config']

  return (
    <div>
      <SecNav sections={sections} active={sec} setActive={setSec} />
      {sec === 'recommendation' && <Recommendation type="draw" leagues={leagues} />}
      {sec === 'history'        && <History        type="draw" />}
      {sec === 'data config'    && <DataConfig     type="draw" />}
    </div>
  )
}
