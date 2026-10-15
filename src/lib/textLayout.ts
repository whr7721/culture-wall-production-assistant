import { Textbox } from 'fabric'
import type { WallElement } from './projects'
export const fontFamilies = ['Microsoft YaHei', 'SimSun', 'Arial'] as const
export function textObject(item: Extract<WallElement, { kind: 'text' }>) {
  return new Textbox(item.text, { width: item.width, fontSize: item.fontSizeMm, fontWeight: item.fontWeight || 700, fontFamily: item.fontFamily || 'Microsoft YaHei', fill: item.color, lineHeight: 1.12, splitByGrapheme: true, strokeWidth: 0, originX: 'left', originY: 'top', angle: item.rotationDeg || 0 })
}
// The same Fabric layout supplies canvas, SVG, PNG and PSD text rendering.
export function textMarkup(item: Extract<WallElement, { kind: 'text' }>) {
  const object = textObject(item)
  return object.toSVG()
}
