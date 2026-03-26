from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape
import zipfile


OUTPUT_PATH = Path("output/doc/全文图表索引.docx")

ENTRIES = [
    ("图2.1超级管理员用例图", "7"),
    ("图2.2用户用例图", "8"),
    ("图2.3管理员用例图", "9"),
    ("图3.1停车管理系统功能结构图", "11"),
    ("图3.2登录流程图", "11"),
    ("图3.3车位预约流程图图", "12"),
    ("图3.4车位管理流程图", "12"),
    ("图3.5车辆实体属性图", "13"),
    ("图3.6用户实体属性图", "14"),
    ("图3.7公告实体属性图", "14"),
    ("图3.8车位实体属性图", "14"),
    ("图3.9违规实体属性图", "15"),
    ("图3.10管理员实体属性图", "15"),
    ("图3.11超级管理员实体属性图", "15"),
    ("图3.12车位预定实体属性图", "16"),
    ("图3.13全局E-R图", "16"),
    ("图4.1停车管理系统总体程序结构图", "21"),
    ("图4.2车位管理界面图", "22"),
    ("图4.3车位预定管理界面图", "22"),
    ("图4.4公告管理界面图", "23"),
    ("图4.5违规管理界面图", "23"),
    ("图4.6车辆管理界面图", "24"),
    ("图4.7基础数据管理界面图", "24"),
    ("图4.8超级管理员界面图", "25"),
    ("图4.9管理员管理界面图", "25"),
    ("图4.10用户管理界面图", "26"),
    ("图4.11轮播图管理界面图", "26"),
    ("图4.12车位管理界面图", "27"),
    ("图4.13车位预定管理界面图", "27"),
    ("图4.14公告管理界面.图", "28"),
    ("图4.15公告类型管理界面图", "28"),
    ("图4.16个人中心管理界面图", "29"),
    ("图5.1登录功能测试用例1结果图", "31"),
    ("图5.2登录功能测试用例2结果图", "31"),
    ("图5.3登录功能测试用例3结果图", "31"),
    ("图5.4车位预约功能测试用例1结果图", "32"),
    ("图5.5车位预约功能测试用例2结果图", "33"),
    ("图5.6车位预约功能测试用例3结果图", "33"),
    ("图5.7车位预约功能测试用例4结果图", "33"),
    ("图5.8.后台车位管理功能测试用例1结果图", "35"),
    ("图5.9后台车位管理功能测试用例2结果图", "35"),
    ("图5.10后台车位管理功能测试用例3结果图", "35"),
    ("图5.11后台车位管理功能测试用例4结果图", "36"),
    ("图5.12后台车位管理功能测试用例5结果图", "36"),
    ("图5.13.后台车位管理功能测试用例6结果图", "37"),
    ("表2.1非功能需求分析表", "9"),
    ("表3.1车辆表", "17"),
    ("表3.2车位表", "17"),
    ("表3.3车位预定表", "18"),
    ("表3.4公告表", "18"),
    ("表3.5违规表", "18"),
    ("表3.6用户表", "19"),
    ("表3.7管理员表", "19"),
    ("表3.8超级表", "19"),
    ("表5.1登录功能测试模块测试用例表", "30"),
    ("表5.2车位预约功能模块测试用例设计表", "32"),
    ("表5.3后台车位管理功能模块测试用例设计表", "34"),
]


def run_props(font_east_asia: str, font_ascii: str, size_half_points: int, bold: bool = False) -> str:
    bold_xml = "<w:b/>" if bold else ""
    return (
        f"<w:rPr>"
        f"<w:rFonts w:ascii=\"{font_ascii}\" w:hAnsi=\"{font_ascii}\" "
        f"w:eastAsia=\"{font_east_asia}\" w:cs=\"{font_ascii}\"/>"
        f"{bold_xml}"
        f"<w:sz w:val=\"{size_half_points}\"/>"
        f"<w:szCs w:val=\"{size_half_points}\"/>"
        f"</w:rPr>"
    )


def paragraph(text: str, *, align: str = "left", size: int = 24, bold: bool = False, spacing_after: int = 0) -> str:
    text_xml = escape(text)
    align_xml = f"<w:jc w:val=\"{align}\"/>" if align != "left" else ""
    return (
        "<w:p>"
        "<w:pPr>"
        f"{align_xml}"
        f"<w:spacing w:before=\"0\" w:after=\"{spacing_after}\" w:line=\"360\" w:lineRule=\"auto\"/>"
        "</w:pPr>"
        "<w:r>"
        f"{run_props('宋体', 'Times New Roman', size, bold=bold)}"
        f"<w:t xml:space=\"preserve\">{text_xml}</w:t>"
        "</w:r>"
        "</w:p>"
    )


def table_row(title: str, page: str) -> str:
    title_xml = escape(title)
    page_xml = escape(page)
    return (
        "<w:tr>"
        "<w:tc>"
        "<w:tcPr><w:tcW w:w=\"8600\" w:type=\"dxa\"/></w:tcPr>"
        "<w:p>"
        "<w:pPr><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"360\" w:lineRule=\"auto\"/></w:pPr>"
        "<w:r>"
        f"{run_props('宋体', 'Times New Roman', 24)}"
        f"<w:t xml:space=\"preserve\">{title_xml}</w:t>"
        "</w:r>"
        "</w:p>"
        "</w:tc>"
        "<w:tc>"
        "<w:tcPr><w:tcW w:w=\"900\" w:type=\"dxa\"/></w:tcPr>"
        "<w:p>"
        "<w:pPr>"
        "<w:jc w:val=\"right\"/>"
        "<w:spacing w:before=\"0\" w:after=\"0\" w:line=\"360\" w:lineRule=\"auto\"/>"
        "</w:pPr>"
        "<w:r>"
        f"{run_props('宋体', 'Times New Roman', 24)}"
        f"<w:t>{page_xml}</w:t>"
        "</w:r>"
        "</w:p>"
        "</w:tc>"
        "</w:tr>"
    )


def build_document_xml() -> str:
    rows = "".join(table_row(title, page) for title, page in ENTRIES)
    title_para = paragraph("全文图表索引", align="center", size=32, bold=True, spacing_after=120)
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
    xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
    xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
    xmlns:v="urn:schemas-microsoft-com:vml"
    xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
    xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
    xmlns:w10="urn:schemas-microsoft-com:office:word"
    xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
    xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"
    xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
    xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
    xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
    xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
    mc:Ignorable="w14 w15 wp14">
  <w:body>
    {title_para}
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="0" w:type="auto"/>
        <w:tblInd w:w="0" w:type="dxa"/>
        <w:tblCellMar>
          <w:top w:w="0" w:type="dxa"/>
          <w:left w:w="80" w:type="dxa"/>
          <w:bottom w:w="0" w:type="dxa"/>
          <w:right w:w="80" w:type="dxa"/>
        </w:tblCellMar>
        <w:tblBorders>
          <w:top w:val="nil"/>
          <w:left w:val="nil"/>
          <w:bottom w:val="nil"/>
          <w:right w:val="nil"/>
          <w:insideH w:val="nil"/>
          <w:insideV w:val="nil"/>
        </w:tblBorders>
      </w:tblPr>
      <w:tblGrid>
        <w:gridCol w:w="8600"/>
        <w:gridCol w:w="900"/>
      </w:tblGrid>
      {rows}
    </w:tbl>
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1800" w:header="720" w:footer="720" w:gutter="0"/>
      <w:cols w:space="425"/>
      <w:docGrid w:type="lines" w:linePitch="312"/>
    </w:sectPr>
  </w:body>
</w:document>
"""


def build_styles_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/>
        <w:lang w:val="zh-CN" w:eastAsia="zh-CN" w:bidi="ar-SA"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault/>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
</w:styles>
"""


def build_content_types_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>
"""


def build_root_rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
"""


def build_core_xml() -> str:
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:dcterms="http://purl.org/dc/terms/"
    xmlns:dcmitype="http://purl.org/dc/dcmitype/"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>全文图表索引</dc:title>
  <dc:creator>Codex</dc:creator>
  <cp:lastModifiedBy>Codex</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>
</cp:coreProperties>
"""


def build_app_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
    xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Office Word</Application>
</Properties>
"""


def build_document_rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>
"""


def main() -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUTPUT_PATH, "w", compression=zipfile.ZIP_DEFLATED) as docx:
        docx.writestr("[Content_Types].xml", build_content_types_xml())
        docx.writestr("_rels/.rels", build_root_rels_xml())
        docx.writestr("docProps/core.xml", build_core_xml())
        docx.writestr("docProps/app.xml", build_app_xml())
        docx.writestr("word/document.xml", build_document_xml())
        docx.writestr("word/styles.xml", build_styles_xml())
        docx.writestr("word/_rels/document.xml.rels", build_document_rels_xml())
    print(OUTPUT_PATH.resolve())


if __name__ == "__main__":
    main()
