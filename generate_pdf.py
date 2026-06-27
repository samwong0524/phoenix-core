# -*- coding: utf-8 -*-
from fpdf import FPDF
import os

FONT_PATH = r'C:/Windows/Fonts/msyh.ttc'
OUTPUT_PATH = r'f:/swarm-ide/永磁式智能物位传感器_市场竞品分析与精准获客方案.pdf'

class ReportPDF(FPDF):
    def __init__(self):
        super().__init__()
        self.add_font('msyh', '', FONT_PATH)
        self.add_font('msyh', 'B', FONT_PATH)
        self.add_font('msyh', 'I', FONT_PATH)

    def header(self):
        if self.page_no() > 1:
            self.set_font('msyh', 'I', 8)
            self.set_text_color(150, 150, 150)
            self.cell(0, 5, '永磁式智能物位传感器 · 市场竞品分析与精准获客方案', align='L')
            self.ln(5)
            self.set_draw_color(200, 200, 200)
            self.line(10, 15, 200, 15)
            self.ln(5)

    def footer(self):
        self.set_y(-15)
        self.set_font('msyh', 'I', 8)
        self.set_text_color(150, 150, 150)
        self.cell(0, 10, f'- {self.page_no()} -', align='C')

    def section_title(self, num, title):
        self.set_font('msyh', 'B', 16)
        self.set_text_color(26, 26, 46)
        self.set_fill_color(26, 115, 232)
        self.cell(1.5, 8, '', new_x='RIGHT', new_y='TOP', fill=True)
        self.cell(5, 8, '', new_x='RIGHT', new_y='TOP')
        self.cell(0, 8, f'{num}  {title}', new_x='LMARGIN', new_y='NEXT')
        self.ln(3)

    def sub_title(self, title):
        self.ln(2)
        self.set_font('msyh', 'B', 13)
        self.set_text_color(26, 115, 232)
        self.cell(0, 8, title, new_x='LMARGIN', new_y='NEXT')
        self.set_draw_color(232, 232, 232)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(3)

    def sub2_title(self, title):
        self.ln(2)
        self.set_font('msyh', 'B', 11)
        self.set_text_color(51, 51, 51)
        self.cell(0, 7, title, new_x='LMARGIN', new_y='NEXT')
        self.ln(2)

    def body_text(self, text):
        self.set_font('msyh', '', 10)
        self.set_text_color(26, 26, 46)
        self.multi_cell(0, 6, text)
        self.ln(2)

    def card(self, text, border_color=(26, 115, 232)):
        x = self.get_x()
        y = self.get_y()
        # Left border line
        self.set_draw_color(*border_color)
        self.set_line_width(1.2)
        self.line(x, y, x, y + 20)
        self.set_line_width(0.2)
        self.set_font('msyh', '', 9.5)
        self.set_text_color(26, 26, 46)
        self.multi_cell(0, 5.5, text)
        self.ln(4)

    def bullet(self, text, indent=10):
        self.set_x(self.l_margin + indent)
        self.set_font('msyh', '', 10)
        self.set_text_color(26, 26, 46)
        self.cell(4, 6, chr(8226))
        self.multi_cell(0, 6, text)

    def table_header(self, headers, col_widths):
        self.set_fill_color(26, 115, 232)
        self.set_text_color(255, 255, 255)
        self.set_font('msyh', 'B', 8)
        for i, h in enumerate(headers):
            self.cell(col_widths[i], 7, h, border=1, fill=True, align='C')
        self.ln()
        self.set_text_color(26, 26, 46)
        self.set_font('msyh', '', 8)

    def table_row(self, cells, col_widths, fill=False, text_color=None):
        if fill:
            self.set_fill_color(248, 249, 250)
        if text_color:
            self.set_text_color(*text_color)
        else:
            self.set_text_color(26, 26, 46)
        self.set_font('msyh', '', 8)
        # Simple row (single line per cell)
        max_lines = 1
        for i, c in enumerate(cells):
            self.cell(col_widths[i], 6, c, border=1, fill=fill, align='C')
        self.ln()

    def multi_row(self, rows_data, col_widths):
        """rows_data: list of lists of strings"""
        for row_idx, row in enumerate(rows_data):
            fill = row_idx % 2 == 1
            if fill:
                self.set_fill_color(248, 249, 250)
            self.set_text_color(26, 26, 46)
            self.set_font('msyh', '', 8)

            # Check if we need a page break
            if self.get_y() > 250:
                self.add_page()

            y_start = self.get_y()
            x_start = self.get_x()

            # First pass: calculate max lines needed
            max_lines = 1
            cell_lines = []
            for i, cell_text in enumerate(row):
                self.set_xy(x_start + sum(col_widths[:i]), y_start)
                self.set_xy(x_start, y_start)
                lines = []
                words = cell_text.split(' ')
                line = ''
                for w in words:
                    test = line + ' ' + w if line else w
                    if self.get_string_width(test) > col_widths[i] - 2:
                        if line:
                            lines.append(line)
                        line = w
                    else:
                        line = test
                if line:
                    lines.append(line)
                cell_lines.append(lines)
                max_lines = max(max_lines, len(lines))

            row_height = max_lines * 5.5

            # Check page break
            if y_start + row_height > 265:
                self.add_page()
                y_start = self.get_y()
                x_start = self.get_x()

            # Draw cells
            for i, lines in enumerate(cell_lines):
                self.set_xy(x_start + sum(col_widths[:i]), y_start)
                if fill:
                    self.set_fill_color(248, 249, 250)
                    self.rect(x_start + sum(col_widths[:i]), y_start, col_widths[i], row_height, 'F')
                self.set_draw_color(200, 200, 200)
                self.rect(x_start + sum(col_widths[:i]), y_start, col_widths[i], row_height, 'D')
                for j, line_text in enumerate(lines):
                    self.set_xy(x_start + sum(col_widths[:i]) + 1, y_start + j * 5.5 + 1)
                    self.cell(col_widths[i] - 2, 5, line_text)

            self.set_xy(x_start, y_start + row_height)
        self.ln(2)


def generate_cover(pdf):
    """封面"""
    pdf.add_page()
    pdf.set_font('msyh', '', 10)
    pdf.ln(30)
    # Line
    pdf.set_draw_color(26, 115, 232)
    pdf.set_line_width(1)
    x = 95
    pdf.line(x, pdf.get_y(), x + 20, pdf.get_y())
    pdf.ln(10)
    # Title
    pdf.set_font('msyh', 'B', 24)
    pdf.set_text_color(26, 26, 46)
    pdf.cell(0, 14, '永磁式智能物位传感器', align='C', new_x='LMARGIN', new_y='NEXT')
    pdf.ln(3)
    pdf.set_font('msyh', '', 14)
    pdf.set_text_color(85, 85, 85)
    pdf.cell(0, 10, '市场竞品分析与精准获客方案', align='C', new_x='LMARGIN', new_y='NEXT')
    pdf.ln(5)
    pdf.set_draw_color(26, 115, 232)
    pdf.line(x, pdf.get_y(), x + 20, pdf.get_y())
    pdf.ln(10)
    # Meta
    pdf.set_font('msyh', '', 10)
    pdf.set_text_color(136, 136, 136)
    meta_items = [
        '产品定位：机电一体化智能物位探测创新方案',
        '核心技术：电磁直驱 + 无触点采样 + 分时工作',
        '目标市场：煤化工 · 疏浚工程 · 饲料加工 · 防爆场景',
    ]
    for m in meta_items:
        pdf.cell(0, 8, m, align='C', new_x='LMARGIN', new_y='NEXT')
    pdf.ln(15)
    pdf.set_text_color(170, 170, 170)
    pdf.cell(0, 7, '编制日期：2025年6月', align='C', new_x='LMARGIN', new_y='NEXT')
    pdf.cell(0, 7, '版本：V1.0', align='C', new_x='LMARGIN', new_y='NEXT')
    pdf.ln(10)
    # Badge
    pdf.set_fill_color(26, 115, 232)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font('msyh', 'B', 10)
    badge_x = 75
    pdf.rect(badge_x, pdf.get_y(), 60, 10, 'F')
    pdf.set_xy(badge_x, pdf.get_y() + 1)
    pdf.cell(60, 8, 'CONFIDENTIAL  内部机密', align='C', new_x='LMARGIN', new_y='NEXT')


def generate_toc(pdf):
    """目录"""
    pdf.add_page()
    pdf.set_font('msyh', 'B', 18)
    pdf.set_text_color(26, 26, 46)
    pdf.cell(0, 10, '目    录', new_x='LMARGIN', new_y='NEXT')
    pdf.set_draw_color(26, 115, 232)
    pdf.set_line_width(1.5)
    pdf.line(10, pdf.get_y(), 100, pdf.get_y())
    pdf.ln(8)

    toc_items = [
        ('01', '产品技术概览', [
            '1.1 核心技术原理',
            '1.2 解决的五大产业难题',
            '1.3 知识产权布局',
        ]),
        ('02', '市场竞品全景对比', [
            '2.1 全球市场概况',
            '2.2 按技术路线分类对比',
            '2.3 核心竞品详细对比',
            '2.4 SWOT 综合分析',
            '2.5 市场定位建议',
        ]),
        ('03', '精准获客策略', [
            '3.1 客户画像与优先级排序',
            '3.2 获客渠道矩阵',
            '3.3 精准狙击打法',
            '3.4 首月落地执行计划',
            '3.5 客户开发话术模板',
            '3.6 客户采购触发信号',
        ]),
        ('04', 'Agent 团队获客架构', [
            '4.1 Agent 团队全景图',
            '4.2 各 Agent 详细设计',
            '4.3 协同工作流',
            '4.4 团队规模与成本估算',
            '4.5 KPI 指标体系',
        ]),
        ('05', '总结与行动建议', [
            '5.1 立即行动清单',
            '5.2 核心原则',
        ]),
    ]

    for num, title, subs in toc_items:
        pdf.set_font('msyh', 'B', 11)
        pdf.set_text_color(26, 115, 232)
        pdf.cell(12, 8, num)
        pdf.cell(0, 8, title, new_x='LMARGIN', new_y='NEXT')
        for sub in subs:
            pdf.set_font('msyh', '', 9.5)
            pdf.set_text_color(100, 100, 100)
            pdf.cell(25, 7, '')
            pdf.cell(0, 7, sub, new_x='LMARGIN', new_y='NEXT')
        pdf.ln(2)


def generate_part1(pdf):
    """Part 1: 产品技术概览"""
    pdf.add_page()
    pdf.section_title('01', '产品技术概览')
    pdf.sub_title('1.1 核心技术原理')
    pdf.body_text('永磁式智能物位传感器创造性地将电磁感应现象与机械摆动相结合，实现机电一体化智能物位探测，突破传统料位传感器或纯机械、或纯电子的技术局限。')

    pdf.set_font('msyh', 'B', 10)
    pdf.set_text_color(26, 26, 46)
    pdf.cell(0, 7, '四大技术支柱：', new_x='LMARGIN', new_y='NEXT')
    pdf.ln(2)

    techs = [
        ('技术一：电磁直驱技术', '利用电磁铁通电产生的电磁力直接驱动永磁摆杆摆动，省去传统机械传动轴与变速装置，比机械转动更简单、高效、省力。'),
        ('技术二：不接触与无触点信号采样', '永磁摆杆摆动形成运动磁场 → 电磁铁线圈磁通变化 → 感应电压信号，实现非接触无触点采样，提升可靠性与稳定性。'),
        ('技术三：电磁铁分时工作', '通电时"电生磁"（驱动），断电时"磁生电"（采样）。同一电磁铁兼具驱动与采样双重功能，减少零部件，简化电路设计。'),
        ('技术四：机械摆动阻尼式探测', '不同介质（气体/液体/固体）对摆杆阻尼不同 → 感应电压信号特征不同 → 智能信号分析处理电路判断介质有无。'),
    ]
    for title, desc in techs:
        pdf.set_font('msyh', 'B', 9.5)
        pdf.set_text_color(26, 115, 232)
        pdf.cell(0, 6, title, new_x='LMARGIN', new_y='NEXT')
        pdf.set_font('msyh', '', 9)
        pdf.set_text_color(26, 26, 46)
        pdf.multi_cell(0, 5, desc)
        pdf.ln(2)

    pdf.sub_title('1.2 解决的五大产业难题')
    problems = [
        ('1. 高温高压', '煤化工气化炉，4.5Mpa，上千度，煤块/煤粉/湿煤，腐蚀性气体', '不锈钢板隔离耐压 + 散热结构设计 + 特种不锈钢丝绳抗砸防腐蚀'),
        ('2. 深水浑浊', '海底隧道抛石摊铺，50米深海，海水腐蚀，砂石冲击，泥砂浑水', '电磁铁/永磁体水下正常工作 + 泥砂浑水不影响 + 保护装置防砸'),
        ('3. 恶劣粉尘', '农牧业料仓（面粉/稻谷/饲料），粉尘多，粘料遮挡，误动作多', '机械检测方法不怕粉尘 + 电子信号输出，工作稳定可靠'),
        ('4. 超低温', '高纬度严寒地区，-40°C以下电子元器件冻坏失效', '分体式设计：探头在低温现场（不怕低温），电子模块在中控室，电缆最长500米'),
        ('5. 危险爆炸', '爆炸性危险场所安全标准与防爆要求不断提高', '电磁铁与永磁体隔着不锈钢板相互作用，轻松解决耐高压和防爆难题'),
    ]
    for title, desc, sol in problems:
        # Check before each problem
        if pdf.get_y() > 200:
            pdf.add_page()
        pdf.set_font('msyh', 'B', 9.5)
        pdf.set_text_color(26, 26, 46)
        pdf.cell(0, 6, title, new_x='LMARGIN', new_y='NEXT')
        pdf.set_font('msyh', '', 9)
        pdf.set_text_color(85, 85, 85)
        pdf.cell(0, 5, '工况：' + desc, new_x='LMARGIN', new_y='NEXT')
        pdf.set_text_color(52, 168, 83)
        pdf.cell(0, 5, '方案：' + sol, new_x='LMARGIN', new_y='NEXT')
        pdf.ln(3)

    pdf.sub_title('1.3 知识产权布局')
    pdf.card('9项国内授权专利 + PCT国际专利\n\n'
             '发明专利（2项）：\n'
             '• 电磁推敲式物体检测装置（ZL201110054676.5，2012.02.22授权）\n'
             '• 一种用于物体检测的动作机构及物体检测装置（2018113328559）\n\n'
             '实用新型专利（2项）：\n'
             '• 一种用于物体检测的动作机构及物体检测装置（ZL201821844933.9）\n\n'
             '外观专利（5项）：\n'
             '• 防爆（ZL201730127354.7）· 螺纹接口（ZL201830072131.X）· 顶装（ZL201830634839.X）· 通用（ZL201830634838.5）· 竖装（ZL201930288275.3）\n\n'
             'PCT国际专利：已进入美国、欧盟、日本、加拿大、澳大利亚、韩国、俄罗斯等国家和经济体',
             border_color=(52, 168, 83))


def generate_part2(pdf):
    """Part 2: 市场竞品全景对比"""
    pdf.add_page()
    pdf.section_title('02', '市场竞品全景对比')
    pdf.sub_title('2.1 全球市场概况')

    # KPI boxes
    pdf.set_fill_color(232, 240, 254)
    pdf.set_font('msyh', 'B', 18)
    pdf.set_text_color(26, 115, 232)
    kpis = [('$55.6亿', '2024年全球市场规模'), ('$76.4亿', '2029年预测规模'), ('6.5%', '年复合增长率 CAGR')]
    for val, label in kpis:
        x = pdf.get_x()
        y = pdf.get_y()
        pdf.rect(x, y, 55, 22, 'F')
        pdf.set_xy(x, y + 2)
        pdf.cell(55, 12, val, align='C', new_x='LMARGIN', new_y='NEXT')
        pdf.set_font('msyh', '', 8)
        pdf.set_text_color(136, 136, 136)
        pdf.set_xy(x, y + 13)
        pdf.cell(55, 7, label, align='C', new_x='LMARGIN', new_y='NEXT')
        pdf.set_x(x + 60)
        pdf.set_y(y)
    pdf.ln(25)

    pdf.body_text('全球主要玩家：ABB、Emerson、AMETEK、Siemens、Honeywell、VEGA、Endress+Hauser')
    pdf.body_text('中国市场格局：进口高端品牌（VEGA、E+H、西门子）占据高端市场，国产中低端品牌（川仪、上海自仪、美安等）拼价格。')

    pdf.sub_title('2.2 按技术路线分类对比')

    cw = [24, 26, 24, 16, 44, 56]
    pdf.table_header(['技术类型', '代表品牌', '价格区间', '市占率', '核心优势', '核心劣势'], cw)
    rows = [
        ['阻旋式（机械）', '西门子/川仪/美安', '¥100-2000', '~50%', '原理简单,成本低', '故障率高,功耗5W,IP54,不能测液位'],
        ['电容式（电子）', 'E+H,AMETEK', '¥200-3000', '~40%', '可连续测量,结构简单', '粘灰误动作,介电常数限制,需调试'],
        ['超声波式', 'Siemens,Holykell', '¥150-5000', '增长中', '非接触,安全', '粉尘/水雾影响大,盲区大'],
        ['雷达式（高端）', 'VEGA,E+H,Siemens', '¥3000-30000+', '增长最快', '非接触,精度高±1mm', '价格昂贵,安装要求高'],
        ['γ核辐射式', 'E+H,国产特种', '¥5万-10万+', '小众', '穿透容器壁,极恶劣环境', '辐射污染,特种资质,放射源昂贵'],
        ['磁翻板/浮球式', '川仪,国产大量', '¥200-2000', '稳定', '直观,便宜', '仅液位,机械卡滞'],
        ['永磁式（本产品）', '本项目产品', '<¥10000', '新兴', '0.5W,IP67,耐温耐压,无辐射', '市场认知度低,生态不成熟'],
    ]
    pdf.multi_row(rows, cw)

    pdf.sub_title('2.3 核心竞品详细对比')

    # vs 阻旋式
    pdf.sub2_title(' vs 阻旋式 - 最大替代目标（市占率50%）')
    cw2 = [32, 78, 80]
    pdf.table_header(['对比维度', '阻旋式（西门子 Milltronics RPM）', '本产品'], cw2)
    vs_rows = [
        ['价格', '¥500-2000', '<¥10000（贵5-20倍）'],
        ['功耗', '~5W（220VAC）', '~0.5W（二线制1.5mA），省90%'],
        ['防护等级', 'IP54', 'IP67（强3级）'],
        ['使用寿命', '2-3年（齿轮磨损）', '10年（3倍+）'],
        ['可动部件', '电机+齿轮组+叶片', '仅永磁摆杆'],
        ['液位检测', '不支持', '支持'],
        ['二线制', '无法实现', '支持'],
        ['市场认知', '极高（50年历史）', '新兴品类，认知度低'],
    ]
    pdf.multi_row(vs_rows, cw2)
    pdf.card('结论：阻旋式最大优势是便宜+认知度高，最大劣势是故障率高+功耗大+不耐恶劣环境。本产品技术全面碾压，但价格是5-20倍的障碍。破局关键是找到阻旋式故障率最高的恶劣工况场景。')

    pdf.sub2_title(' vs 电容式 - 第二大替代目标（市占率40%）')
    pdf.table_header(['对比维度', '电容式（E+H CapaMatic）', '本产品'], cw2)
    vs2_rows = [
        ['价格', '¥200-3000', '<¥10000'],
        ['连续测量', '支持', '仅定点检测'],
        ['粘灰影响', '严重（需定期清理）', '不受影响'],
        ['介电常数', '低介电常数无法测', '不受限制'],
        ['维护量', '大（调灵敏度+清理）', '小（免调试）'],
        ['防护等级', 'IP54', 'IP67'],
    ]
    pdf.multi_row(vs2_rows, cw2)
    pdf.card('结论：电容式能连续测量是优势，但在粘灰、低介电常数物料场景表现差。本产品的机会：粉尘料仓、粉煤灰、低介电常数物料场景。', (251, 188, 4))

    # vs 雷达式
    pdf.sub2_title(' vs 雷达式 - 高端市场霸主')
    pdf.table_header(['对比维度', '雷达式（VEGA VEGAPULS）', '本产品'], cw2)
    vs3_rows = [
        ['价格', '¥3000-30000+', '<¥10000（便宜3-10倍）'],
        ['测量方式', '非接触连续测量', '接触式定点检测'],
        ['精度', '±1mm级', '定点（有/无）'],
        ['粉尘影响', '低频率雷达受影响', '不受影响'],
        ['品牌壁垒', 'VEGA品牌极强', '无品牌认知'],
    ]
    pdf.multi_row(vs3_rows, cw2)
    pdf.card('结论：雷达式在精度和连续测量上碾压本产品，但价格是本产品3-10倍。本产品的机会在中端市场替代雷达式（对精度要求不高的场景）。')

    # vs 核辐射式
    pdf.sub2_title(' vs γ核辐射式 - 最贵竞品')
    pdf.table_header(['对比维度', 'γ核辐射式', '本产品'], cw2)
    vs4_rows = [
        ['价格', '¥50000-100000+', '<¥10000（便宜5-10倍）'],
        ['安全性', '辐射污染+特种资质', '无辐射+免资质'],
        ['使用寿命', '5年（放射源衰减）', '10年（2倍）'],
        ['维护要求', '需特种许可证', '普通工人即可'],
        ['穿透能力', '穿透任何容器壁', '需不锈钢板隔离'],
    ]
    pdf.multi_row(vs4_rows, cw2)
    pdf.card('结论：γ核辐射式是极端环境唯一选择，本产品可替代大部分非极端场景，性价比优势巨大，安全环保是核心卖点。', (52, 168, 83))

    # SWOT
    pdf.sub_title('2.4 SWOT 综合分析')
    cw_swot = [90, 100]
    # S
    pdf.set_fill_color(52, 168, 83)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font('msyh', 'B', 10)
    pdf.cell(cw_swot[0], 7, '  优势（Strengths）', border=1, fill=True)
    pdf.cell(cw_swot[1], 7, '  劣势（Weaknesses）', border=1, fill=True)
    pdf.ln()
    s_text = ('• 技术原理创新：机电一体化融合\n• 超低功耗：0.5W / 1.5mA，可做二线制\n• 防护等级高：IP67，-60°C~600°C，4.5Mpa\n• 安全环保：无辐射、免特种资质\n• 性价比高：1万以内 vs 竞品5-10万\n• 维护简单：免调试、免清理\n• 专利壁垒：9项国内+PCT国际')
    w_text = ('• 市场认知度为零：全新品类\n• 仅定点检测：不能连续测量\n• 生态系统薄弱：无成熟渠道\n• 品牌影响力弱：无VEGA/E+H信任度\n• 精度信息不透明')
    y_start = pdf.get_y()
    x_start = pdf.get_x()
    # Draw boxes
    pdf.set_draw_color(200, 200, 200)
    pdf.rect(x_start, y_start, cw_swot[0], 40, 'D')
    pdf.rect(x_start + cw_swot[0], y_start, cw_swot[1], 40, 'D')
    # Text
    pdf.set_xy(x_start + 1, y_start + 1)
    pdf.set_font('msyh', '', 8)
    pdf.set_text_color(26, 26, 46)
    pdf.multi_cell(cw_swot[0] - 2, 5, s_text)
    pdf.set_xy(x_start + cw_swot[0] + 1, y_start + 1)
    pdf.multi_cell(cw_swot[1] - 2, 5, w_text)
    pdf.set_y(y_start + 42)
    # O/T
    pdf.set_fill_color(26, 115, 232)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font('msyh', 'B', 10)
    pdf.cell(cw_swot[0], 7, '  机会（Opportunities）', border=1, fill=True)
    pdf.set_fill_color(251, 188, 4)
    pdf.set_text_color(51, 51, 51)
    pdf.cell(cw_swot[1], 7, '  威胁（Threats）', border=1, fill=True)
    pdf.ln()
    o_text = ('• 阻旋式替代市场巨大（50%份额）\n• 二线制微功耗趋势\n• 安全标准提升（防爆要求提高）\n• 出海潜力（已有PCT专利）\n• 国产替代政策')
    t_text = ('• VEGA/E+H向下延伸降价\n• 阻旋式价格战（压到100元以下）\n• 电容式技术升级\n• 客户惯性（不愿换已验证方案）')
    y_start2 = pdf.get_y()
    pdf.set_draw_color(200, 200, 200)
    pdf.rect(x_start, y_start2, cw_swot[0], 35, 'D')
    pdf.rect(x_start + cw_swot[0], y_start2, cw_swot[1], 35, 'D')
    pdf.set_xy(x_start + 1, y_start2 + 1)
    pdf.set_font('msyh', '', 8)
    pdf.set_text_color(26, 26, 46)
    pdf.multi_cell(cw_swot[0] - 2, 5, o_text)
    pdf.set_xy(x_start + cw_swot[0] + 1, y_start2 + 1)
    pdf.multi_cell(cw_swot[1] - 2, 5, t_text)
    pdf.set_y(y_start2 + 37)

    # 市场定位
    pdf.sub_title('2.5 市场定位优先级')
    cw_pos = [16, 30, 28, 58, 58]
    pdf.table_header(['优先级', '目标市场', '替代竞品', '核心卖点', '策略'], cw_pos)
    pos_rows = [
        ['🔥🔥🔥', '煤化工高温高压', 'γ核辐射式', '安全+便宜5倍+免资质', '直接替换方案'],
        ['🔥🔥🔥', '阻旋式替换市场', '阻旋式', '故障率↓+功耗↓90%+IP67', '故障案例切入'],
        ['🔥🔥', '农牧业粉尘料仓', '电容式', '不怕粉尘+免清理+免调试', '内容营销'],
        ['🔥🔥', '海底疏浚工程', '超声波/阻旋式', '水下工作+抗泥沙冲击', '标杆案例'],
        ['🔥', '超低温场景', '传统电子式', '-60°C工作+分体设计', '方案销售'],
        ['🔥', '防爆场所', 'BCK系列/阻旋防爆', 'IP67+二线制+安全', '渠道合作'],
    ]
    pdf.multi_row(pos_rows, cw_pos)


def generate_part3(pdf):
    """Part 3: 精准获客策略"""
    pdf.add_page()
    pdf.section_title('03', '精准获客策略')
    pdf.sub_title('3.1 客户画像与优先级排序')

    cw_cust = [14, 28, 36, 66, 46]
    pdf.table_header(['优先级', '客户画像', '典型企业', '核心痛点', '决策人'], cw_cust)
    cust_rows = [
        ['🔥🔥🔥', '煤化工/冶金企业', '神华、宝钢、中石化、万华', 'γ核辐射到期、高温高压频繁坏', '设备科长/仪表工程师'],
        ['🔥🔥🔥', '疏浚工程公司', '中交疏浚、上海/天津航道局', '海底抛石摊铺料位检测靠人工', '项目经理/总工'],
        ['🔥🔥', '饲料/面粉/粮食加工', '中粮、正大饲料、益海嘉里', '阻旋式粉尘环境每月坏2-3个', '设备部主管'],
        ['🔥🔥', '自动化养殖设备商', '广兴牧业、京鹏农牧、温氏', '小口径送料管料位检测不准', '采购/技术总监'],
        ['🔥', '低温仓储/液氮', '中集安瑞科、北方化工厂', '-40°C以下电子元器件冻坏', '仪表工程师'],
        ['🔥', '防爆场景（化工/制药）', '恒力石化、荣盛石化、药明康德', '防爆标准提高，旧阻旋式不达标', '安全总监/设备部'],
    ]
    pdf.multi_row(cust_rows, cw_cust)

    pdf.sub_title('3.2 获客渠道矩阵')
    pdf.sub2_title('线上渠道（低成本启动）')
    cw_ch = [26, 84, 80]
    pdf.table_header(['渠道', '具体做法', '预期效果'], cw_ch)
    ch_rows = [
        ['1688/阿里巴巴', '开店上架，关键词：料位传感器、阻旋式替代、高温料位计', '被动获客，询盘转化'],
        ['百度竞价(SEM)', '投故障词：阻旋式料位传感器故障、料位计替换、高温料位计', '精准捕获搜索需求'],
        ['抖音/视频号', '拍工况对比视频：阻旋式坏了 vs 本产品正常运行', '工业品短视频蓝海'],
        ['知乎/公众号', '技术文章：《阻旋式料位传感器为什么老是坏？》', '长尾SEO + 专业信任'],
        ['慧聪网/工控网', '注册工控平台供应商（仪表采购必看）', '垂直B2B流量'],
        ['LinkedIn', '搜索instrumentation engineer + 目标公司（出海）', '海外客户开发'],
    ]
    pdf.multi_row(ch_rows, cw_ch)

    pdf.sub2_title('渠道合作（借力打力）')
    ch2_rows = [
        ['仪表工程公司/集成商', '找煤化工/冶金自动化改造公司代推', '手握客户信任'],
        ['阻旋式传感器经销商', '让他们多卖一个产品线，赚差价', '现成客户群'],
        ['DCS/PLC集成商', '和西门子/和利时/中控集成商合作', '项目入口'],
        ['行业协会', '中国仪器仪表协会、煤化工协会', '展会 + 会员通讯录'],
    ]
    pdf.multi_row(ch2_rows, cw_ch)

    pdf.sub2_title('线下渠道（高信任度）')
    ch3_rows = [
        ['行业展会', '上海国际仪器仪表展、煤化工展、饲料工业展', '展位费1-3万/场'],
        ['技术交流会', '去目标企业做免费技术培训', '差旅费'],
        ['标杆案例', '先在1-2家大客户免费/半价试用', '产品成本'],
        ['老客户转介绍', '仪表圈子小，一个设备科长推荐5个客户', '口碑传播'],
    ]
    pdf.multi_row(ch3_rows, cw_ch)

    pdf.sub_title('3.3 精准狙击打法')

    pdf.set_font('msyh', 'B', 10)
    pdf.set_text_color(234, 67, 53)
    pdf.cell(0, 7, '策略一：从"故障"切入（最高转化率）', new_x='LMARGIN', new_y='NEXT')
    pdf.set_font('msyh', '', 9)
    pdf.set_text_color(26, 26, 46)
    pdf.body_text('逻辑：客户正在被故障折磨 → 搜解决方案 → 你正好出现')
    pdf.bullet('百度/360投故障词："阻旋式料位计老是坏""料位传感器误动作""电容式料位计粘灰"')
    pdf.bullet('抖音发故障案例：拍现场坏掉的阻旋式传感器（齿轮卡死、电机烧毁），然后展示本产品')
    pdf.bullet('写故障分析文章：《煤化工厂一年换了27个料位传感器，后来……》')
    pdf.ln(3)

    pdf.set_font('msyh', 'B', 10)
    pdf.set_text_color(26, 115, 232)
    pdf.cell(0, 7, '策略二：从"替换"切入（最直接）', new_x='LMARGIN', new_y='NEXT')
    pdf.set_font('msyh', '', 9)
    pdf.set_text_color(26, 26, 46)
    pdf.body_text('逻辑：客户已经在找替代品 → 你直接提供方案')
    pdf.bullet('做"替换对照表"：西门子Milltronics XXX型号 → 本产品XXX型号，一一对应')
    pdf.bullet('做"免费替换方案"：客户提供现有料位计型号，免费出替换方案和报价')
    pdf.bullet('工控论坛发帖："有没有被阻旋式料位传感器折磨的兄弟？" → 引流到产品')
    pdf.ln(3)

    pdf.set_font('msyh', 'B', 10)
    pdf.set_text_color(52, 168, 83)
    pdf.cell(0, 7, '策略三：从"行业解决方案"切入（最专业）', new_x='LMARGIN', new_y='NEXT')
    pdf.set_font('msyh', '', 9)
    pdf.set_text_color(26, 26, 46)
    pdf.body_text('逻辑：不是卖传感器，是卖"煤化工高温高压料位检测方案"')
    pdf.bullet('出行业白皮书：《煤化工密闭料仓料位检测白皮书》→ 免费下载 → 留资')
    pdf.bullet('做行业标杆案例：先搞定1家煤化工龙头 → 全行业跟着上')
    pdf.bullet('参加行业标准制定：进煤化工/饲料工业协会技术委员会 → 行业话语权')
    pdf.ln(3)

    pdf.sub_title('3.4 首月落地执行计划')
    pdf.ln(2)
    pdf.body_text('第1周 搭建线上触点 → 第2周 内容生产 → 第3周 渠道开发 → 第4周 标杆攻坚')
    pdf.ln(2)

    cw_plan = [22, 88, 80]
    pdf.table_header(['周次', '具体任务', '交付物'], cw_plan)
    plan_rows = [
        ['第1周\n搭建线上触点', '• 1688开店上架3个主推型号\n• 注册工控网、慧聪网供应商\n• 开通微信公众号\n• 百度竞价开户，投5个故障关键词', '线上触点全覆盖\n开始接收询盘'],
        ['第2周\n内容生产', '• 写3篇技术文章\n• 拍2个对比视频\n• 做一份《料位传感器选型指南》PDF', '3篇文章+2个视频\n1份PDF指南'],
        ['第3周\n渠道开发', '• 企查查搜目标行业导出联系人\n• 联系3家仪表工程公司谈合作\n• 报名参加最近一场行业展会', '线索库50+条\n3家渠道合作意向'],
        ['第4周\n标杆攻坚', '• 选1-2家痛点最强企业做免费试用\n• 技术团队陪同安装调试\n• 收集数据做案例报告', '1-2个标杆试用\n首份案例报告'],
    ]
    pdf.multi_row(plan_rows, cw_plan)

    pdf.sub_title('3.5 客户开发话术模板')
    pdf.card('电话开发话术（设备科长/仪表工程师）：\n\n"X工您好，我是XX仪表的。注意到咱们厂用的是阻旋式料位传感器，我们这边做了个新产品，专治阻旋式在高温高压/粉尘环境下故障率高的问题。功耗只有原来的1/10，IP67防护，寿命10年。想给您寄个样品免费试用一下，您看方便给个地址吗？"', (156, 39, 176))

    pdf.card('微信开发话术：\n\n"X工好，我们是做永磁式智能物位传感器的。简单说就是：\n  阻旋式的替代升级\n  功耗0.5W（只有阻旋式的1/10）\n  IP67防护，耐高温高压\n  10年寿命，免维护\n我们在XX厂已经试用了X个月，故障率从每月2次降到0。您那边料位检测有没有遇到什么问题？可以聊聊看我们能不能帮您解决。"', (156, 39, 176))

    pdf.sub_title('3.6 客户采购触发信号')
    cw_trig = [40, 80, 70]
    pdf.table_header(['触发信号', '说明', '发现方式'], cw_trig)
    trig_rows = [
        ['设备大修/技改', '年度检修期要换一批传感器', '关注招标公告'],
        ['安全事故后', '爆炸/泄漏事故后加强安全标准', '看新闻/应急管理局公告'],
        ['新项目建设', '新建煤化工/饲料厂项目', '看发改委审批/环评公示'],
        ['环保督查后', '密闭式改造要求', '看环保部门通报'],
        ['批量故障', '同一批传感器频繁坏', '工控论坛/微信群吐槽'],
    ]
    pdf.multi_row(trig_rows, cw_trig)


def generate_part4(pdf):
    """Part 4: Agent 团队获客架构"""
    pdf.add_page()
    pdf.section_title('04', 'Agent 团队获客架构')
    pdf.sub_title('4.1 Agent 团队全景图')

    # Draw team diagram
    y = pdf.get_y()
    # Commander
    pdf.set_fill_color(26, 115, 232)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font('msyh', 'B', 10)
    pdf.rect(55, y, 90, 12, 'F')
    pdf.set_xy(55, y + 2)
    pdf.cell(90, 8, '  指挥官 Agent  -  总调度  策略决策  资源分配', align='C', new_x='LMARGIN', new_y='NEXT')

    # Lines
    pdf.set_draw_color(26, 115, 232)
    pdf.set_line_width(0.8)
    pdf.line(100, y + 12, 100, y + 20)
    pdf.line(100, y + 20, 35, y + 20)
    pdf.line(100, y + 20, 100, y + 20)
    pdf.line(100, y + 20, 165, y + 20)
    pdf.line(35, y + 20, 35, y + 25)
    pdf.line(100, y + 20, 100, y + 25)
    pdf.line(165, y + 20, 165, y + 25)

    # Three agents row 1
    agents1 = [
        ('侦察 Agent', '市场研究+线索挖掘'),
        ('内容 Agent', '内容生产+SEO'),
        ('出击 Agent', '客户触达+跟进'),
    ]
    pdf.set_fill_color(232, 240, 254)
    pdf.set_text_color(26, 26, 46)
    pdf.set_font('msyh', 'B', 9)
    for i, (name, desc) in enumerate(agents1):
        x = 20 + i * 65
        pdf.rect(x, y + 25, 55, 12, 'F')
        pdf.set_xy(x, y + 26)
        pdf.cell(55, 6, name, align='C', new_x='LMARGIN', new_y='NEXT')
        pdf.set_font('msyh', '', 7)
        pdf.set_text_color(136, 136, 136)
        pdf.set_xy(x, y + 32)
        pdf.cell(55, 5, desc, align='C', new_x='LMARGIN', new_y='NEXT')

    # Lines to row 2
    pdf.set_draw_color(26, 115, 232)
    for i in range(3):
        x = 47 + i * 65
        pdf.line(x, y + 37, x, y + 45)
        pdf.line(x, y + 45, x, y + 50)

    # Three agents row 2
    agents2 = [
        ('分析 Agent', '数据清洗+优先级'),
        ('渠道 Agent', '平台运营+投放'),
        ('交付 Agent', '试用+安装+案例'),
    ]
    pdf.set_fill_color(232, 240, 254)
    pdf.set_text_color(26, 26, 46)
    pdf.set_font('msyh', 'B', 9)
    for i, (name, desc) in enumerate(agents2):
        x = 20 + i * 65
        pdf.rect(x, y + 50, 55, 12, 'F')
        pdf.set_xy(x, y + 51)
        pdf.cell(55, 6, name, align='C', new_x='LMARGIN', new_y='NEXT')
        pdf.set_font('msyh', '', 7)
        pdf.set_text_color(136, 136, 136)
        pdf.set_xy(x, y + 57)
        pdf.cell(55, 5, desc, align='C', new_x='LMARGIN', new_y='NEXT')

    pdf.set_y(y + 68)

    pdf.sub_title('4.2 各 Agent 详细设计')

    # Commander
    pdf.set_font('msyh', 'B', 11)
    pdf.set_text_color(26, 26, 46)
    pdf.cell(0, 7, '  指挥官 Agent（总调度）', new_x='LMARGIN', new_y='NEXT')
    pdf.set_font('msyh', '', 9)
    pdf.cell(0, 5, '角色：策略大脑，统筹全局，做优先级决策', new_x='LMARGIN', new_y='NEXT')
    pdf.cell(0, 5, '输入：各Agent报告 + 销售数据 + 市场反馈', new_x='LMARGIN', new_y='NEXT')
    pdf.cell(0, 5, '输出：每周作战指令、资源分配调整、策略迭代', new_x='LMARGIN', new_y='NEXT')
    pdf.cell(0, 5, '运行频率：每日晨会复盘 + 每周策略调整', new_x='LMARGIN', new_y='NEXT')
    pdf.ln(3)

    # 侦察
    pdf.set_font('msyh', 'B', 11)
    pdf.set_text_color(26, 26, 46)
    pdf.cell(0, 7, '  侦察 Agent（市场研究 + 线索挖掘）', new_x='LMARGIN', new_y='NEXT')
    pdf.set_font('msyh', '', 9)
    pdf.cell(0, 5, '工具链：企查查/天眼查 API → 招标网爬虫 → 环保局公告 → 新闻监控 → 工控论坛', new_x='LMARGIN', new_y='NEXT')
    pdf.cell(0, 5, '输出：客户线索表（企业名称、联系人、电话、痛点标签、优先级）', new_x='LMARGIN', new_y='NEXT')
    pdf.ln(2)
    pdf.body_text('目标行业列表 → 企查查批量检索 → 招标网爬虫 → 采购信号捕获 → 结构化线索表')
    pdf.ln(2)

    # 内容
    pdf.set_font('msyh', 'B', 11)
    pdf.set_text_color(26, 26, 46)
    pdf.cell(0, 7, '  内容 Agent（内容生产 + SEO）', new_x='LMARGIN', new_y='NEXT')
    cw_ct = [24, 38, 20, 108]
    pdf.table_header(['内容类型', '目标渠道', '频率', '示例'], cw_ct)
    ct_rows = [
        ['技术文章', '知乎/公众号/工控网', '每周2篇', '《阻旋式料位传感器为什么在煤化工场景老是坏？》'],
        ['故障案例视频', '抖音/视频号', '每周1个', '拍坏掉的阻旋式 vs 本产品运行对比'],
        ['行业白皮书', '官网/邮件留资', '每月1份', '《煤化工厂料位检测选型白皮书2025》'],
        ['产品对比表', '1688/销售话术', '每月更新', '本产品 vs 西门子Milltronics 参数对比'],
        ['技术问答', '知乎/百度知道', '每周3条', '"高温高压工况用什么料位传感器好？"'],
    ]
    pdf.multi_row(ct_rows, cw_ct)
    pdf.ln(2)

    # 出击
    pdf.set_font('msyh', 'B', 11)
    pdf.set_text_color(26, 26, 46)
    pdf.cell(0, 7, '  出击 Agent（客户触达 + 跟进）', new_x='LMARGIN', new_y='NEXT')
    pdf.set_font('msyh', '', 9)
    pdf.cell(0, 5, '触达SOP（5步跟进法）：', new_x='LMARGIN', new_y='NEXT')
    cw_sop = [22, 88, 80]
    pdf.table_header(['时间节点', '动作', '目标'], cw_sop)
    sop_rows = [
        ['Day 0', '首次电话触达', '确认需求 + 发送产品资料'],
        ['Day 1', '未接通→发短信+加微信 / 已接通→安排技术交流', '建立联系通道'],
        ['Day 3', '已微信→发故障案例视频+选型指南', '培育信任'],
        ['Day 7', '有意向→推动免费试用 / 无意向→每周发文章', '获取试用机会'],
        ['Day 30', '出试用报告→推动正式采购', '成交转化'],
    ]
    pdf.multi_row(sop_rows, cw_sop)
    pdf.ln(2)

    # 分析
    pdf.set_font('msyh', 'B', 11)
    pdf.set_text_color(26, 26, 46)
    pdf.cell(0, 7, '  分析 Agent（数据清洗 + 优先级排序）', new_x='LMARGIN', new_y='NEXT')
    pdf.set_font('msyh', '', 9)
    pdf.cell(0, 5, '核心看板：', new_x='LMARGIN', new_y='NEXT')
    pdf.body_text('获客漏斗：曝光量 → 点击量 → 留资量 → 有效线索 → 试用申请 → 成交')
    pdf.body_text('渠道ROI：1688/百度竞价/抖音/电话开发 → 每渠道¥XX/询盘，转化率XX%')
    pdf.body_text('客户画像动态更新：最热行业 → 最热场景 → 决策人职位分布')
    pdf.ln(2)

    # 渠道
    pdf.set_font('msyh', 'B', 11)
    pdf.set_text_color(26, 26, 46)
    pdf.cell(0, 7, '  渠道 Agent（平台运营 + 广告投放）', new_x='LMARGIN', new_y='NEXT')
    pdf.set_font('msyh', '', 9)
    pdf.bullet('1688/阿里巴巴：产品上架（3个主推型号）+ 关键词优化 + 店铺装修 + 每日询盘响应')
    pdf.bullet('百度竞价：关键词投放（故障词/替换词/场景词）+ 落地页优化 + 每日预算控制 + ROI监控')
    pdf.bullet('抖音/视频号：视频发布（每周1个）+ 评论区互动 + 私信自动回复 + 投DOU+')
    pdf.bullet('工控网/慧聪网：供应商资料完善 + 产品上架 + 行业论坛发帖')
    pdf.ln(2)

    # 交付
    pdf.set_font('msyh', 'B', 11)
    pdf.set_text_color(26, 26, 46)
    pdf.cell(0, 7, '  交付 Agent（试用管理 + 案例沉淀）', new_x='LMARGIN', new_y='NEXT')
    pdf.set_font('msyh', '', 9)
    pdf.cell(0, 5, '试用SOP（8步法）：', new_x='LMARGIN', new_y='NEXT')
    pdf.body_text('选客户 → 发样品 → 远程指导 → 现场支持 → 数据采集 → 出报告 → 要证言 → 转销售')
    pdf.ln(3)

    pdf.sub_title('4.3 协同工作流')
    pdf.sub2_title('日常循环（每日）')
    cw_daily = [20, 28, 142]
    pdf.table_header(['时间', 'Agent', '任务'], cw_daily)
    daily_rows = [
        ['08:00', '指挥官', '晨会复盘昨日数据，下发今日任务'],
        ['08:30', '侦察', '更新线索表，新增20条高优先级线索'],
        ['09:00', '出击', '开始电话触达，目标10通/天'],
        ['09:00', '内容', '产出今日内容（文章/视频/问答）'],
        ['09:30', '渠道', '优化广告、回复询盘、上架新产品'],
        ['14:00', '分析', '汇总上午数据，出午报'],
        ['14:30', '指挥官', '根据午报调整下午策略'],
        ['17:00', '交付', '跟进试用客户进度'],
        ['18:00', '分析', '出日报，指挥官复盘'],
    ]
    pdf.multi_row(daily_rows, cw_daily)

    pdf.sub2_title('周循环')
    pdf.set_font('msyh', '', 9)
    weeks = [
        ('周一', '指挥官定本周目标 → 侦察Agent找50条新线索 → 出击Agent排期'),
        ('周二', '内容Agent发2篇文章 → 渠道Agent优化广告 → 出击Agent触达'),
        ('周三', '内容Agent发视频 → 出击Agent跟进意向客户 → 交付Agent现场支持'),
        ('周四', '内容Agent发文章 → 渠道Agent投DOU+ → 出击Agent推动试用'),
        ('周五', '周复盘 → 数据看板更新 → 下周策略调整 → 标杆案例整理'),
    ]
    for day, task in weeks:
        pdf.set_font('msyh', 'B', 9)
        pdf.cell(15, 6, day)
        pdf.set_font('msyh', '', 9)
        pdf.multi_cell(175, 6, task)
        pdf.ln(1)
    pdf.ln(3)

    pdf.sub_title('4.4 团队规模与成本估算')
    cw_team = [28, 40, 60, 62]
    pdf.table_header(['阶段', '目标', '配置', '月成本'], cw_team)
    team_rows = [
        ['MVP（1-2月）', '跑通获客闭环', '指挥官(1人) + AI Agent×3', '¥1-2万'],
        ['放大（3-6月）', '月均30条有效线索', 'AI Agent×6 + 销售2人', '¥5-8万'],
        ['规模化（6-12月）', '月均100条线索,10单成交', 'AI Agent×6 + 团队8人', '¥15-25万'],
    ]
    pdf.multi_row(team_rows, cw_team)

    pdf.card('MVP 最精简配置（推荐起步）：1个人 + AI工具\n\n'
             '人 = 指挥官 + 出击（电话/微信）\n'
             'AI = 侦察（企查查爬虫）+ 内容（LLM写作）+ 渠道（自动投放）\n'
             '目标：月均10条有效线索，2-3个试用客户',
             border_color=(52, 168, 83))

    pdf.sub_title('4.5 KPI 指标体系')
    cw_kpi = [50, 40, 50, 50]
    pdf.table_header(['指标', '第1月', '第3月', '第6月'], cw_kpi)
    kpi_rows = [
        ['新增线索数', '100条', '300条', '800条'],
        ['有效线索率', '10%', '20%', '30%'],
        ['试用申请', '3个', '10个', '25个'],
        ['试用转成交', '33%', '50%', '60%'],
        ['单客获客成本', '¥2,000', '¥1,000', '¥500'],
        ['成交客户数', '1个', '5个', '15个'],
    ]
    pdf.multi_row(kpi_rows, cw_kpi)


def generate_part5(pdf):
    """Part 5: 总结与行动建议"""
    pdf.add_page()
    pdf.section_title('05', '总结与行动建议')

    # Summary box
    pdf.set_fill_color(102, 126, 234)
    pdf.set_text_color(255, 255, 255)
    y = pdf.get_y()
    pdf.rect(10, y, 190, 35, 'F')
    pdf.set_xy(15, y + 3)
    pdf.set_font('msyh', 'B', 12)
    pdf.cell(180, 7, '  一句话总结', new_x='LMARGIN', new_y='NEXT')
    pdf.set_xy(15, y + 11)
    pdf.set_font('msyh', '', 9)
    pdf.multi_cell(180, 5, '永磁式智能物位传感器在技术上具有明显差异化优势（低功耗0.5W、高防护IP67、耐极端环境-60°C~600°C），但面临阻旋式50%市占 + 极低价格的最大市场壁垒。')
    pdf.set_xy(15, y + 22)
    pdf.set_font('msyh', '', 9)
    pdf.multi_cell(180, 5, '破局关键：锁定最痛的3个场景（煤化工高温高压、疏浚工程、饲料粉尘料仓），用"故障案例 + 替换方案 + 免费试用"三步走，先打透一个场景建立标杆，再复制到行业。')
    pdf.set_y(y + 40)

    pdf.sub_title('5.1 立即行动清单（Next 7 Days）')
    cw_act = [10, 32, 80, 28, 40]
    pdf.table_header(['#', '行动项', '具体内容', '负责人', '交付物'], cw_act)
    act_rows = [
        ['1', '完善产品资料包', '技术参数表、安装指南、竞品对比表、选型指南PDF', '技术部', '4份文档'],
        ['2', '上线1688店铺', '上架防水型/高温型/小型3个主推产品，优化关键词', '运营', '店铺上线'],
        ['3', '搭建百度竞价', '开户+投放5个故障关键词，预算¥200/天', '运营', '广告上线'],
        ['4', '产出首批内容', '3篇技术文章（阻旋式故障/电容式局限/核辐射替代）', '内容', '3篇文章'],
        ['5', '建立线索库', '企查查检索煤化工/饲料/疏浚行业，导出50条线索', '销售', '线索表'],
        ['6', '确定标杆试用客户', '选1-2家痛点最强的企业，沟通免费试用', '销售+技术', '试用协议'],
        ['7', '拍摄对比视频', '阻旋式坏了的现场 vs 本产品正常运行，剪辑发布抖音', '内容', '2个视频'],
    ]
    pdf.multi_row(act_rows, cw_act)

    pdf.sub_title('5.2 核心原则')
    pdf.card('让AI做重复劳动（找线索、写内容、投广告），让人做高价值事（谈客户、搞关系、搞定标杆）。', (26, 115, 232))
    pdf.card('MVP阶段：1个人 + AI工具即可启动，先跑通闭环再放大。', (52, 168, 83))
    pdf.card('增长飞轮：标杆案例 → 行业口碑 → 更多线索 → 更多案例 → 品牌建立。', (251, 188, 4))

    pdf.ln(8)
    pdf.set_fill_color(52, 168, 83)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font('msyh', 'B', 11)
    y2 = pdf.get_y()
    pdf.rect(30, y2, 150, 14, 'F')
    pdf.set_xy(30, y2 + 3)
    pdf.cell(150, 8, '技术优势 x 精准获客 x Agent效率 = 市场突破', align='C', new_x='LMARGIN', new_y='NEXT')

    pdf.ln(15)
    pdf.set_font('msyh', 'I', 8)
    pdf.set_text_color(170, 170, 170)
    pdf.cell(0, 7, '永磁式智能物位传感器 · 市场竞品分析与精准获客方案 · V1.0 · 2025年6月', align='C', new_x='LMARGIN', new_y='NEXT')


if __name__ == '__main__':
    pdf = ReportPDF()
    pdf.set_auto_page_break(auto=True, margin=20)

    generate_cover(pdf)
    generate_toc(pdf)
    generate_part1(pdf)
    generate_part2(pdf)
    generate_part3(pdf)
    generate_part4(pdf)
    generate_part5(pdf)

    pdf.output(OUTPUT_PATH)
    print(f'PDF generated: {OUTPUT_PATH}')
    print(f'Total pages: {pdf.page_no()}')
