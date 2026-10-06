import io
import json
import sys
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle


def render(data):
    record = data['record']
    check = record['inspection']
    pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
    body = ParagraphStyle('body', fontName='STSong-Light', fontSize=11, leading=18)
    heading = ParagraphStyle('heading', parent=body, fontSize=21, leading=30, spaceAfter=18)
    warning = ParagraphStyle('warning', parent=body, fontSize=13, textColor=colors.HexColor('#935b12'))
    para = lambda value, style=body: Paragraph(escape(str(value)), style)
    story = [para('隔離示範｜非正式檢查紀錄', warning), Spacer(1, 15),
             para(('每日' if check['requirement']['cycle'] == 'daily' else '每月') + '檢查示範表', heading),
             para('設備：' + check['equipment']['name']), para('期間：' + check['period']),
             para('填報角色：' + data['label']), para('檢查時間：' + check['actualAt']), Spacer(1, 18)]
    results = {'normal': '正常', 'abnormal': '異常', 'not_applicable': '不適用'}
    rows = [[para(text) for text in ['項次', '檢查項目', '結果', '備註']]]
    for number, item in enumerate(check['template']['items'], 1):
        answer = check['answers'][item['id']]
        rows.append([para(number), para(item['label']), para(results[answer['result']]), para(answer.get('note', ''))])
    table = Table(rows, colWidths=[38, 180, 55, 220], repeatRows=1)
    table.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e8f1eb')),
                              ('GRID', (0, 0), (-1, -1), .5, colors.HexColor('#95a99c')),
                              ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                              ('TOPPADDING', (0, 0), (-1, -1), 9),
                              ('BOTTOMPADDING', (0, 0), (-1, -1), 9)]))
    story += [table, Spacer(1, 22), para('簽名：示範引用，非本人電子簽名。'),
              para('紀錄編號：' + record['id']), Spacer(1, 12),
              para('僅使用虛構項目驗證流程，非完整核定檢查表。', warning)]
    output = io.BytesIO()
    document = SimpleDocTemplate(output, leftMargin=42, rightMargin=42, topMargin=42,
                                 bottomMargin=42, title='隔離示範檢查表')
    document.build(story)
    return output.getvalue()


if __name__ == '__main__':
    data = json.loads(sys.stdin.buffer.read(500000).decode('utf-8'))
    sys.stdout.buffer.write(render(data))
