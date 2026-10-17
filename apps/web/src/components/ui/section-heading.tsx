'use client'
import { type ReactNode } from 'react'

export function SectionHeading({
  title,
  help,
  children,
}: {
  title: string
  help?: string
  children?: ReactNode
}) {
  return (
    <div className="tab-heading">
      <div>
        <h2>{title}</h2>
        {help && <p>{help}</p>}
      </div>
      <div className="wrap-actions">{children}</div>
    </div>
  )
}
