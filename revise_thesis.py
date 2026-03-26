import copy
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W_NS}
XML_NS = "http://www.w3.org/XML/1998/namespace"
ET.register_namespace("w", W_NS)


def qn(tag: str) -> str:
    prefix, name = tag.split(":")
    if prefix != "w":
        raise ValueError(tag)
    return f"{{{W_NS}}}{name}"


CITATION_RE = re.compile(
    r"\[(\d+(?:\s*[-–—]\s*\d+)?(?:\s*[、,，]\s*\d+(?:\s*[-–—]\s*\d+)?)*)\]"
)
REF_LINE_RE = re.compile(r"^\[(\d+)\]")
CHAPTER_RE = re.compile(r"^第[一二三四五六七八九十0-9]+章")
SECTION_RE = re.compile(r"^\d+\.\d+\s")
SUBSECTION_RE = re.compile(r"^\d+\.\d+\.\d+\s")
CAPTION_RE = re.compile(r"^(图|表)\s*\d")


REPLACEMENTS = {
    0: "摘要：随着夜间经济持续发展，夜市逐渐成为集消费、社交与城市文化展示于一体的重要空间。但传统夜市在信息发布、摊位管理和空间组织方面仍以线下方式为主，存在信息分散、查询不便和管理效率不高等问题。针对这一现状，本文设计并实现了一个基于 Leaflet 与 Flask 的智慧夜市空间信息可视化平台。系统采用前后端分离架构，前端以 HTML、CSS、JavaScript 和 Leaflet 完成地图展示与交互，后端基于 Flask 提供认证、查询、审核、通知等接口服务，数据库采用 SQLite 存储核心业务数据。平台面向普通用户、商户和管理员三类角色，支持摊位地图浏览、条件筛选、热力图展示、摊位申请、评价互动、后台审核与日志追踪等功能。测试结果表明，系统在当前数据规模下运行稳定，能够较好满足毕业设计场景中对夜市空间信息展示与管理的需求。研究说明，将 WebGIS 技术引入夜市信息服务场景具有较强可行性，也可为类似生活服务类空间信息平台建设提供参考。",
    1: "关键词：智慧夜市；空间信息可视化；WebGIS；Leaflet；Flask",
    29: "随着夜间经济和城市数字化治理不断推进，夜市既是消费空间，也是城市公共服务与地方文化展示的重要节点。已有研究表明，夜间消费活动通常具有明显的空间集聚特征，其形成过程与交通可达性、人口流动和商业环境密切相关[16-18]。因此，借助 WebGIS 对夜市位置、经营类别和服务信息进行统一组织，具有明确的现实必要性。",
    30: "WebGIS 已由传统专业化工具逐步转向轻量化、开放化应用，浏览器端空间信息发布、查询与交互能力不断增强[1][22]。与此同时，三维 WebGIS、专题地理信息系统以及面向数字孪生的 GIS 实践表明，开源框架能够较好支撑不同场景下的空间信息服务[2][3][6]，这为智慧夜市平台的构建提供了成熟的技术基础。",
    31: "在前端层面，Leaflet 等轻量级地图库显著降低了专题地图开发门槛。相关研究指出，开源 Web 地图框架在浏览器适配、交互组织和扩展性方面表现稳定[4][23][25][27]；云渲染与专题地图可视化研究也说明，良好的图形表达方式能够提升空间信息的可读性[5]。因此，以 Leaflet 构建夜市地图界面具有较强可行性。",
    32: "在后端与数据处理层面，Python 生态完善、开发效率较高，既适合地理空间数据可视化，也适合快速构建中小型 Web 服务[7-9][19]。因此，选择 Python 与 Flask 作为平台开发基础，能够在实现效率、维护成本与系统扩展性之间取得较好平衡。",
    33: '现有研究多聚焦 WebGIS 架构、地图表达或夜间消费空间分布，对“夜市空间管理、在线服务与多角色协同”一体化平台的讨论仍然不足。围绕具体夜市场景开展系统设计与实现，能够补充应用层面的研究。',
    35: "本文以智慧夜市空间信息可视化平台为对象，从理论和实践两个层面展开研究。理论上，本文将 WebGIS、地图可视化与夜间消费空间研究结合起来，为专题空间信息系统在夜经济场景中的应用提供案例；实践上，平台可提升夜市信息管理效率，改善用户获取信息的方式，并为管理者提供更直观的空间展示手段。",
    41: "国内关于 WebGIS 与地图可视化的研究已从一般平台建设拓展到校园地图、红色资源展示和三维专题系统等多个场景[1-4]。国外研究则更加重视浏览器端空间发布、前端地理处理工具和开源框架适用性分析[22-23][25][27]。总体来看，开源 WebGIS 技术路线已经较为成熟，可为智慧夜市平台的前端设计、空间展示和交互组织提供直接借鉴。",
    45: "Python 与 Flask 相关研究表明，Python 在数据处理、可视化和空间信息表达方面具有较好的综合适配性[7-9]，Flask 则因结构轻量、接口组织清晰而适合中小型平台开发[19]。因此，以 Python 负责数据处理、以 Flask 提供后端服务，符合本系统的技术需求。",
    48: "关于夜市与夜间消费空间的研究，学者普遍关注消费集聚、空间分布和流动摊贩选址机制[16-18]。国外研究进一步引入多源数据和适宜性评价方法，对夜间旅游与夜间消费的空间特征进行了识别[29-30]。这些成果为本文分析夜市信息组织方式、功能需求和场景边界提供了现实依据。",
    52: "已有研究为本文奠定了较好的基础：WebGIS 与开源地图库研究为平台架构和地图交互设计提供了技术支撑[1][4][22][25][27]，Python 与 Flask 研究为后端实现与数据处理提供了方法参考[8][9][19]，夜间消费空间研究则说明了夜市场景具有明确的空间服务需求[16-18][29-30]。但现有成果对具体应用场景下的系统化实现讨论仍不充分，这正是本文的切入点。",
    53: "基于上述不足，本文将研究重心放在以真实业务流程组织系统功能，而非单纯罗列技术组件。换言之，本文既关注地图展示效果，也强调提交、审核、发布与反馈等过程能否在同一平台内顺畅衔接。",
    55: "本文围绕智慧夜市空间信息可视化平台开展研究，重点包括三方面内容：一是分析夜市信息展示与平台管理需求，明确系统角色、功能模块与总体架构；二是基于 WebGIS 完成夜市空间数据的地图化表达与交互展示；三是基于 Flask 构建后端接口与业务流程，实现多角色协同管理。",
    57: "通过上述研究，本文希望构建一个兼顾空间展示、业务管理与用户服务的 WebGIS 平台，为夜市信息数字化治理提供可落地的实现思路，也为类似专题空间信息系统的开发提供参考。",
    59: "研究过程中，本文综合采用文献分析、系统分析与软件工程方法，按照“需求分析—系统设计—功能实现—测试验证”的路径推进。技术路线主要包括需求建模、前后端架构设计、数据库设计、核心模块实现以及系统测试五个阶段，从而形成较完整的专题平台开发过程。",
    62: "在架构设计阶段，本文尤其关注地图展示层与业务服务层之间的接口划分，尽量避免前端直接承担过多业务判断，使空间可视化逻辑与后台治理逻辑能够相对独立地演进。",
    68: "全文共分为六章：第一章为绪论；第二章分析系统需求；第三章说明总体设计；第四章介绍系统实现；第五章给出测试与结果分析；第六章总结研究工作并提出改进方向。",
    73: "本系统的目标是构建一个面向普通用户、商户和管理员的智慧夜市平台，将摊位位置、商户信息、经营状态和服务公告等数据统一组织到地图界面中，实现“空间展示、信息查询、业务维护和后台治理”的协同。相较于传统分散的信息发布方式，该平台更强调空间对象与业务对象的一体化表达。",
    75: "进一步看，平台建设不仅要完成静态信息展示，还要把摊位位置、经营状态、商户资料、用户评价和公告通知等内容统一到同一空间对象上。只有实现空间信息与业务信息的联动，平台才真正具备服务与治理价值。",
    77: "从技术角度看，夜市场景天然具有明确的地理位置和属性信息，适合采用 WebGIS 进行组织与展示[2][22][23][25]。Leaflet 能较好承担地图加载、点位标注与图层控制等前端任务，Flask 适合承载权限控制、数据接口与业务逻辑处理[4][9]，因此平台具备较好的技术可行性。",
    81: "从经济角度看，系统采用的 Leaflet、Flask 和 SQLite 均为开源或轻量级技术，开发与部署成本较低，硬件环境要求不高，符合本科毕业设计项目的资源条件。夜市业务数据结构相对清晰，也降低了数据整理和后期维护成本。",
    84: "从操作角度看，平台主要服务对象为管理员、商户和普通用户三类角色。地图浏览、条件筛选、表单维护与后台审核等交互方式均符合常见 Web 应用习惯，用户理解成本较低；同时，角色边界明确，也有利于后续运维和日常管理。",
    87: "业务需求分析的重点是明确不同角色的任务边界与信息流转关系。整体上，管理员负责基础数据维护和平台治理，商户负责经营信息更新，普通用户负责浏览、筛选、评价和接收反馈，三者共同构成平台的业务闭环。",
    88: "管理员侧的核心需求包括摊位与商户数据维护、提交审核、公告发布、异常用户处理和平台运行记录查询。其目标并非单纯维护数据，而是通过制度化流程保证平台信息的准确性、时效性和可追溯性。",
    89: "商户侧更关注经营信息的可见性与更新效率。平台需要支持摊位申请、资料修改、营业状态维护、评价回复和消息查看，使商户能够及时更新展示内容，并与后台审核流程保持一致。",
    90: "普通用户侧的核心需求是快速获得可信、可筛选的夜市信息，包括地图浏览、关键词检索、分类筛选、查看详情、提交评价和接收通知等。平台应帮助用户把“找得到、看得懂、能反馈”整合到同一界面中。",
    91: "从整体业务流程看，平台运行可概括为“管理员维护基础数据—商户补充经营信息—用户查询并反馈—后台再次治理”的循环机制。该机制既保证了内容持续更新，也使夜市信息服务具有可管理、可追踪的特点。",
    93: "在功能层面，系统可分为用户端、商户端、管理员端和通用支撑功能四部分[22][27]。前台强调地图展示、检索筛选与互动反馈，后台强调数据维护、审核管理和运行记录，通用层则负责身份认证、字段校验、异常提示和状态反馈。",
    94: "用户端应提供夜市地图浏览、摊位详情查看、关键词搜索、分类筛选、热力图切换以及评价与通知查看等功能，以满足信息获取与消费决策需求。",
    95: "账户体系是系统运行的基础。平台需要支持注册、登录、退出及角色识别，并根据用户身份动态分配可访问页面和可执行操作，确保浏览、经营和治理活动在对应权限范围内完成。",
    96: "商户端应支持摊位新增申请、信息修改、营业状态切换、评价回复和消息查看，使经营者能够围绕单个摊位持续更新内容，并通过审核流程保证公开数据的规范性。",
    97: "管理员端应具备摊位审核、评价审核、用户管理、公告维护和日志查看等功能，既负责信息发布前的把关，也负责平台运行中的治理和纠偏。",
    98: "通用支撑功能主要包括前后端数据交互、表单校验、异常提示、分页查询与权限控制等内容。这些能力虽然不直接面向业务场景，但决定了系统能否稳定地支撑多角色协同。",
    99: "从用例角度看，普通用户的典型任务包括浏览地图、筛选摊位、查看详情和提交评价；商户侧任务包括提交资料、修改信息和回复评价；管理员侧任务则集中在审核、治理与日志查询。这些用例共同构成了系统功能设计的边界。",
    101: "除业务功能外，系统还需满足易用性、可靠性、可维护性、性能和安全性等非功能需求。具体而言，前台界面应保持简洁直观，后台操作应具备必要的数据校验与错误处理，系统结构要便于后续扩展，同时在一般校园演示和小规模访问条件下保持基本响应速度，并通过认证与权限机制限制未授权访问。",
    102: "易用性方面，平台界面需要保持入口清晰、信息层次明确，尤其是地图浏览、条件筛选和详情查看之间的跳转应尽量简洁，避免用户在多页面间反复切换。",
    103: "可靠性方面，系统应确保摊位位置、经营状态和商户资料在前后端展示中保持一致，对新增、修改和删除操作进行必要约束，减少因误操作造成的数据异常。",
    104: "可维护性方面，平台应保持模块划分清晰、接口命名规范、数据表关系明确，使后续新增字段、扩展功能或替换技术组件时能够在较低成本下完成。",
    105: "性能方面，虽然本系统不面向高并发生产场景，但仍需保证地图加载、列表查询、筛选刷新和后台分页管理在一般校园演示环境下保持可接受的响应速度。",
    106: "安全性方面，系统必须根据角色差异控制页面访问与数据操作范围，并通过登录认证、令牌校验和参数检查等机制降低未授权访问和越权操作风险。",
    109: "平台采用前后端分离的总体架构。前端负责地图展示和交互组织，后端负责接口服务和业务处理，数据层负责保存用户、摊位、评价、通知与日志等核心数据。该架构有助于分离展示逻辑与业务逻辑，提高系统可维护性[1][19][27]。",
    111: "前端展示层以 HTML、CSS 和 JavaScript 为基础，并结合 Leaflet 实现底图加载、点位标注、弹窗展示和热力图切换。通过地图这一统一入口，用户能够在空间语境下完成浏览、检索和详情查看。",
    112: "后端服务层基于 Flask 构建 RESTful API，负责用户认证、权限控制、分页查询、数据校验和业务流程处理。各类接口按照认证、公开查询、商户业务、用户业务和管理员业务分组组织，使系统边界更加清晰。",
    113: "数据存储层采用 SQLite 维护核心业务数据，包括用户、摊位、提交记录、评价、回复、通知和审计日志等表。该方案部署简便、维护成本较低，适合本科项目的开发与演示需求。",
    114: "系统运行时，前端通过 HTTP 请求调用后端接口，后端完成查询或写入后再将结果以 JSON 形式返回前端，最终在地图、列表或表单中完成展示与反馈。",
    115: "这种分层架构既保证了页面交互与业务处理的相对独立，也为后续接入更多数据源、扩展统计功能或替换数据库方案提供了结构基础。",
    124: "普通用户模块围绕“查询与反馈”展开，主要提供地图浏览、关键词搜索、分类筛选、热力图查看、评价提交和评论互动等功能，使用户能够在同一入口内完成从发现摊位到形成反馈的全过程。",
    132: "商户模块围绕“维护与响应”展开，主要包括摊位申请、资料修改、营业状态管理和评价回复等功能。其设计目标是在保证后台审核机制有效运行的前提下，提高经营信息更新的及时性。",
    139: "管理员模块围绕“审核与治理”展开，包括摊位审核、评价审核、用户管理和系统日志查询等功能。通过后台统一管理，平台能够对公开信息的准确性、用户行为的规范性以及关键操作的可追溯性进行控制。",
    145: "3.3 系统业务流程设计",
    146: "业务流程设计强调前后台协同。普通用户通过地图和筛选功能获取信息，商户通过表单提交和更新经营内容，管理员则在后台对新增、修改与评价内容进行审核和治理，三类角色共同构成平台的动态运行机制。",
    148: "在用户查询流程中，前台先根据关键词或分类条件向后端发起请求，后端返回匹配的摊位数据后，前端再将结果同步到地图与列表区域。用户点击点位或列表条目后，可继续查看摊位详情、营业状态和评价信息。",
    150: "在后台维护流程中，管理员对摊位新增、修改和下架等操作进行统一治理。系统会先完成身份验证和字段检查，再将合法数据写入数据库或生成相应日志，以保证管理过程具有规则约束。",
    152: "在地图展示流程中，后端先输出摊位坐标与属性数据，前端再完成底图加载、点位渲染、弹窗绑定和图层切换。当用户切换筛选条件或热力图模式时，前端会重新请求数据并刷新地图状态。",
    158: "数据库设计采用关系型结构，以 users、stalls、submissions、reviews、review_replies、notifications 和 audit_logs 为核心数据表。各表分别承担用户身份管理、摊位主数据维护、提交审核、评价互动、消息通知和操作追踪等职责，从而支撑系统的查询、审核与反馈流程。",
    160: "在实体设计上，用户、摊位与评价构成平台的基础数据骨架，提交记录、回复记录与通知数据则用于支撑动态业务过程，审计日志则负责保留治理痕迹。通过主数据与过程数据分离，系统能够在保持结构清晰的同时兼顾运行追踪需求。",
    189: "系统采用 RESTful API 向前端提供服务，数据交换格式为 JSON，并通过 Bearer Token 完成身份验证。在接口设计上，平台围绕“登录认证—摊位查询—信息提交—后台审核”构建主流程，以保证不同角色都能在统一规则下完成业务操作。",
    190: "结合系统业务流程，登录认证、摊位查询、信息提交和管理员审核四类接口基本覆盖了“访问系统—查询信息—提交数据—审核发布”的主要链路，也最能体现本平台的数据组织方式。",
    192: "登录接口负责统一认证入口。当前端提交用户名、密码和角色信息后，后端校验账号状态并返回访问令牌，为后续受保护资源访问提供基础。",
    199: "摊位查询接口面向前台地图展示，支持分页、关键词、分类、评分和排序等条件组合，既服务于列表展示，也服务于地图定位和筛选分析。",
    206: "摊位提交接口主要用于商户新增或修改摊位信息。后端在校验关键字段后，将数据写入提交记录而非直接写入正式摊位表，以避免未经审核的信息直接进入公开展示区。",
    213: "管理员审核接口负责处理提交记录的通过与驳回。当审核通过时，系统将新增或修改内容写入摊位主表；当审核驳回时，系统记录原因并通知提交者，从而形成“先提交、后审核、再发布”的治理机制。",
    224: "通过上述接口设计，平台完成了从用户认证、数据查询到提交审核的前后端闭环，也为多角色协同运行提供了稳定的数据通道。",
    230: "系统实现采用前后端分离方式：前端负责地图展示、页面交互和表单处理，后端负责权限校验、接口服务、数据存储和业务逻辑，数据库使用 SQLite 保存核心业务数据。整体运行环境较轻量，便于本地开发、测试与演示。",
    237: "程序结构按照角色和业务边界划分为展示层、服务层和数据层。前端页面分别面向普通用户、商户和管理员；后端集中定义认证、查询、审核、通知与日志等接口；数据层则为各类业务记录提供持久化支持。",
    239: "在前端实现上，用户端页面侧重地图展示、筛选检索与通知查看，商户端页面侧重经营信息维护与评价回复，管理员页面则聚焦审核、用户治理和日志管理。页面分工与角色职责基本保持一致。",
    243: "在数据层中，各类业务表通过主键、外键或关联字段形成相对稳定的关系结构，例如评价与用户、摊位之间存在对应关系，提交记录又与正式摊位数据相互衔接，这为后续统计和追踪提供了基础。",
    248: "管理员功能是平台治理的核心，主要包括摊位提交审核、评价审核、用户状态管理、摊位维护和审计日志查看等模块。其目标是保证公开信息可控、操作过程可追踪。",
    254: "在摊位提交审核模块中，管理员可查看商户提交的新增或修改申请，并根据字段完整性、位置合理性和内容规范性进行通过或驳回。审核结果会同步更新提交记录、摊位主表和通知消息。",
    256: "这一模块的核心价值在于把数据治理前置到发布环节。通过“提交—审核—展示”的分步机制，平台能够在保证信息更新效率的同时，降低错误位置、重复摊位或不规范描述直接公开的风险。",
    261: "评价审核模块用于控制公开内容质量。用户评价在发布前先进入待审状态，管理员审核通过后才对外展示，审核驳回则保留记录并向评价用户反馈结果。",
    268: "用户数据管理模块支持管理员查看平台账户，并对异常或违规账号执行冻结和解冻操作。该功能有助于维持平台秩序，也体现了系统在账户层面的治理能力。",
    275: "摊位管理模块允许管理员直接对已发布摊位执行下架、恢复或删除操作，使平台在新增审核之外，还具备对存量数据进行持续维护的能力。",
    281: "审计日志模块统一记录管理员在审核、用户管理和摊位治理中的关键操作，便于后续问题排查、责任定位和运行回溯。",
    288: "商户端是平台内容供给的重要入口，其功能设计强调“便捷维护”和“与后台审核协同”。通过商户端，经营者可以持续更新摊位信息并响应用户反馈。",
    292: "商户首次入驻时，需要提交摊位名称、类别、营业时间、经纬度位置和描述等信息。系统在完成字段校验后生成待审记录，只有审核通过后的数据才会进入公开展示区。",
    294: "这种“先提交、后审核”的实现方式有助于把数据质量控制前置到发布之前，既降低了错误信息直接进入地图界面的风险，也使商户端的数据维护过程更加规范。",
    299: "对已审核通过的摊位，商户可以发起修改申请并切换营业状态。这样既能维护摊位静态属性，又能反映夜市经营过程中的动态变化。",
    301: "营业状态管理使平台展示内容更贴近真实经营场景。对于夜市这种时间性较强的空间服务对象而言，是否出摊、何时营业往往直接影响用户决策，因此动态状态信息具有较强的实用价值。",
    307: "在评价回复模块中，商户可对已公开的用户评价进行回应，系统会保存回复内容并向对应用户发送提醒，从而形成基本的双向互动机制。",
    315: "通知模块用于向商户反馈审核结果、摊位状态变化等业务信息，减少其反复进入各页面查询处理结果的成本。",
    323: "用户端是系统直接面向公众的入口，其实现重点在于地图浏览、信息筛选、评价互动和消息反馈。相比后台功能，用户端更强调操作直观和信息获取效率。",
    327: "地图展示模块通过 Leaflet 加载底图并叠加摊位点位。用户点击标记即可查看摊位名称、类别、营业时间、评分和营业状态等信息，从而以空间方式理解夜市布局。",
    334: "热力图与筛选模块在点位展示基础上增加了密度表达和多条件检索能力。用户可按关键词、类别、评分或距离筛选目标摊位，也可通过热力图快速识别夜市热点区域。",
    336: "热力图与筛选功能使地图展示不再停留于静态浏览，而是具备了一定的分析能力。对于摊位数量较多的场景，热度分布有助于观察热点区域，筛选功能则有助于用户快速缩小检索范围。",
    341: "评价提交与互动回复模块使用户能够在浏览信息之外参与平台内容建设。评价在通过审核后公开展示，并可继续查看商户回复，形成较完整的服务反馈链条。",
    349: "通知查看模块帮助用户及时获取评价审核结果、商户回复及其它与自身相关的业务消息，增强了前台使用体验的完整性。",
    351: "通知机制的意义不仅在于消息提示，更在于把用户的操作结果继续反馈给用户本人。这样一来，评价、回复和审核不再是彼此割裂的单点动作，而是形成了连续的服务过程。",
    357: "综合来看，系统实现较好地覆盖了地图展示、审核管理、评价互动、通知反馈与日志追踪等核心功能，基本形成了围绕夜市空间信息组织与治理的业务闭环。",
    363: "测试环境以本地开发部署为基础：后端使用 Flask 提供 REST API，前端通过浏览器访问页面并调用接口，数据以 JSON 形式在前后端之间传递。测试数据来自初始化样本和开发调试过程中形成的业务记录，能够覆盖新增提交、审核、评价、回复和消息通知等主要场景。",
    373: "功能测试按角色划分为普通用户、商户和管理员三类。测试结果表明，地图浏览、条件筛选、摊位申请、审核处理、评价回复和日志查看等核心功能均能按预期运行，系统具备较完整的业务闭环。",
    387: "异常测试主要围绕未授权访问、参数错误、重复审核和越权访问展开。结果显示，系统能够返回相应的 401、400 或 403 状态码，并阻止非法请求继续执行，说明认证、字段校验和权限控制机制基本有效。",
    409: "性能分析采用本地轻量级采样方法，对热力图接口、摊位列表接口和管理员列表接口进行测试。结果表明，在当前数据规模下，接口响应时间总体处于可接受范围，能够满足毕业设计场景下的信息展示与管理需求，但尚不能等同于高并发生产环境表现。",
    417: "从不同接口类型的表现看，登录类接口结构简单、返回较快；带有筛选、排序和统计计算的列表接口耗时相对更高，但在本地测试环境下仍保持在可接受区间。这说明当前技术方案足以支撑中小规模演示场景。",
    419: "结合测试结果可以看出，平台在功能完整性、权限控制和业务闭环三个方面表现较为稳定。商户提交—管理员审核—公开展示，以及用户评价—管理员审核—商户回复—通知反馈等关键流程均已跑通，说明系统实现与前期设计目标基本一致。",
    420: "首先，系统功能完整性较好。地图展示、摊位管理、评价系统、审核流程、通知机制与审计日志等主要功能都已打通，说明平台整体实现与前期设计目标基本一致。",
    421: "其次，系统权限控制有效。普通用户、商户和管理员三类角色在接口访问范围与页面操作权限上区分明确，测试过程中未出现普通用户直接执行管理员操作的情况。",
    422: "再次，系统业务闭环可用。无论是商户提交摊位后进入公开展示，还是用户评价后收到商户回复与通知，都表明系统不仅具有独立模块，也具备跨模块联动能力。",
    423: "最后，在当前数据规模与本地部署条件下，系统的基础响应速度能够满足毕业设计演示需要。不过，这一结果主要反映轻量级场景下的表现，仍需要在更复杂环境中继续验证。",
    425: "与此同时，系统仍存在一些可继续完善的地方。例如，SQLite 更适合单机和小规模场景，后续若访问量提升，需要考虑迁移至更适合并发写入的数据库；此外，前端渲染性能评估、缓存机制和更完整的自动化测试体系也值得在后续工作中补充。",
    430: "第六章 结论与展望",
    431: "第六章从研究总结、实践价值、局限性和后续优化四个方面对全文进行归纳，以说明本系统在本科毕业设计层面的完成情况与后续延展空间。",
    434: "本文围绕智慧夜市空间信息可视化平台的设计与实现展开研究，针对夜市信息分散、空间位置不直观和管理流程缺乏统一平台等问题，构建了一个基于 WebGIS 的多角色信息服务系统。平台以 Leaflet 完成空间可视化，以 Flask 提供后端服务，实现了地图展示、摊位申请、审核管理、评价互动和通知反馈等核心功能。",
    435: "在系统实现层面，平台采用前后端分离的结构，将展示逻辑、业务处理和数据存储分开组织；在业务流程层面，系统形成了“提交—审核—发布”和“评价—审核—回复—通知”两条核心闭环；在测试层面，主要功能和常见异常场景均得到了验证。这说明平台已经具备较好的演示与应用基础。",
    442: "综合来看，本文并未停留在界面展示或局部模块实现，而是尽量围绕真实使用过程搭建起较完整的平台原型。对于本科毕业设计而言，这种从需求到实现、再到测试验证的完整链条，本身也体现了较强的工程实践意义。",
    445: "本文的创新点主要体现在工程实践而非算法创新上：一是将 WebGIS 应用于夜市场景，强化了夜市信息的空间化表达；二是通过用户、商户和管理员三类角色构建协同管理机制；三是围绕摊位审核和评价互动设计了较完整的业务闭环；四是以 Flask、Leaflet 和 SQLite 组成轻量化技术栈，验证了小型专题平台的可实现性。",
    447: "在空间表达层面，本文将夜市这一日常生活服务场景与 WebGIS 结合起来，不再只用文字或列表描述信息，而是通过地图、点位与热力表达重构用户获取信息的方式。这种处理方式提升了系统对空间关系的解释能力。",
    449: "在平台组织层面，三类角色的分工并非简单的页面拆分，而是对应信息生产、审核与消费的不同环节。角色设计与业务流程相互对应，使系统不仅能够展示数据，也能够对数据进行持续治理。",
    451: "在流程设计层面，本文尤其强调摊位申请与评价互动两条闭环。与单纯静态展示型平台相比，这种闭环机制更能体现信息生命周期管理思路，也更符合夜市场景中信息持续变化的特点。",
    453: "在技术实现层面，平台使用的技术栈保持了轻量化和可部署性。相较于依赖重型 GIS 平台的实现路径，这种方案更适合教学实践、小型专题系统和快速原型验证。",
    457: "受时间、资源和实验条件限制，系统仍存在一定局限，包括单机部署下的并发能力有限、云端部署与监控体系尚未完善、安全策略仍以基础认证和权限控制为主，以及尚未引入更深入的数据分析和推荐功能。",
    468: "后续工作可从四个方向推进：一是结合容器化部署和云端运行环境完善系统发布流程[11]；二是进一步细化权限控制与安全治理策略；三是结合时空数据分析方法增强客流与热点识别能力；四是通过推荐机制与性能优化提升用户体验和平台可扩展性。",
    481: "总体而言，本文完成了智慧夜市空间信息可视化平台从需求分析、系统设计到功能实现与测试验证的全过程。研究表明，借助 WebGIS 和轻量级 Web 技术构建夜市信息服务平台具有较强的可行性，也为类似生活服务场景的空间信息系统建设提供了参考。",
}


def parse_number_chunk(chunk: str) -> list[int]:
    numbers: list[int] = []
    parts = re.split(r"\s*[、,，]\s*", chunk.strip())
    for part in parts:
        if not part:
            continue
        if re.fullmatch(r"\d+\s*[-–—]\s*\d+", part):
            start, end = [int(x) for x in re.split(r"\s*[-–—]\s*", part)]
            step = 1 if start <= end else -1
            numbers.extend(range(start, end + step, step))
        elif part.isdigit():
            numbers.append(int(part))
    return numbers


def format_number_chunk(numbers: list[int]) -> str:
    ordered = sorted(dict.fromkeys(numbers))
    if not ordered:
        return ""
    groups: list[str] = []
    start = ordered[0]
    prev = ordered[0]
    for number in ordered[1:]:
        if number == prev + 1:
            prev = number
            continue
        groups.append(f"{start}-{prev}" if start != prev else str(start))
        start = prev = number
    groups.append(f"{start}-{prev}" if start != prev else str(start))
    return ",".join(groups)


def paragraph_text(paragraph: ET.Element) -> str:
    return "".join(t.text or "" for t in paragraph.findall(".//w:t", NS)).strip()


def ensure_child(parent: ET.Element, child_tag: str) -> ET.Element:
    child = parent.find(child_tag, NS)
    if child is None:
        child = ET.SubElement(parent, qn(child_tag))
    return child


def set_paragraph_text(paragraph: ET.Element, text: str) -> None:
    ppr = paragraph.find("w:pPr", NS)
    for child in list(paragraph):
        if child is not ppr:
            paragraph.remove(child)
    if not text:
        return
    run = ET.Element(qn("w:r"))
    t = ET.SubElement(run, qn("w:t"))
    if text.startswith(" ") or text.endswith(" ") or "  " in text:
        t.set(f"{{{XML_NS}}}space", "preserve")
    t.text = text
    paragraph.append(run)


def set_paragraph_style(paragraph: ET.Element, style_id: str) -> None:
    ppr = paragraph.find("w:pPr", NS)
    if ppr is None:
        ppr = ET.Element(qn("w:pPr"))
        paragraph.insert(0, ppr)
    pstyle = ppr.find("w:pStyle", NS)
    if pstyle is None:
        pstyle = ET.SubElement(ppr, qn("w:pStyle"))
    pstyle.set(qn("w:val"), style_id)


def is_preserved_heading_or_caption(text: str) -> bool:
    return bool(
        CHAPTER_RE.match(text)
        or SECTION_RE.match(text)
        or SUBSECTION_RE.match(text)
        or CAPTION_RE.match(text)
        or text in {"参考文献", "结束语"}
    )


def collect_citation_order(texts: list[str], ref_heading_idx: int) -> list[int]:
    order: list[int] = []
    seen: set[int] = set()
    for text in texts[:ref_heading_idx]:
        for match in CITATION_RE.finditer(text):
            for number in parse_number_chunk(match.group(1)):
                if number not in seen:
                    seen.add(number)
                    order.append(number)
    return order


def transform_citation_text(text: str, mapping: dict[int, int]) -> str:
    matches = list(CITATION_RE.finditer(text))
    if not matches:
        return text

    result: list[str] = []
    cursor = 0
    idx = 0

    while idx < len(matches):
        current = matches[idx]
        cluster = [current]
        j = idx + 1
        while j < len(matches):
            gap = text[cluster[-1].end() : matches[j].start()]
            if gap.strip():
                break
            cluster.append(matches[j])
            j += 1

        result.append(text[cursor : cluster[0].start()])
        transformed = []
        for match in cluster:
            old_numbers = parse_number_chunk(match.group(1))
            new_numbers = [mapping[number] for number in old_numbers if number in mapping]
            if not new_numbers:
                continue
            transformed.append((min(new_numbers), f"[{format_number_chunk(new_numbers)}]"))
        transformed.sort(key=lambda item: item[0])
        result.append("".join(item[1] for item in transformed))

        cursor = cluster[-1].end()
        idx = j

    result.append(text[cursor:])
    return "".join(result)


def set_run_style(style: ET.Element, east_asia_font: str, ascii_font: str, size: str, bold: bool = False) -> None:
    rpr = ensure_child(style, "w:rPr")
    fonts = ensure_child(rpr, "w:rFonts")
    fonts.set(qn("w:eastAsia"), east_asia_font)
    fonts.set(qn("w:ascii"), ascii_font)
    fonts.set(qn("w:hAnsi"), ascii_font)
    sz = ensure_child(rpr, "w:sz")
    sz.set(qn("w:val"), size)
    szcs = ensure_child(rpr, "w:szCs")
    szcs.set(qn("w:val"), size)
    bold_node = rpr.find("w:b", NS)
    if bold:
        if bold_node is None:
            bold_node = ET.SubElement(rpr, qn("w:b"))
        bold_node.set(qn("w:val"), "1")
    elif bold_node is not None:
        rpr.remove(bold_node)


def set_paragraph_style_props(style: ET.Element, *, first_line: str | None = None, align: str = "both", line: str = "360", before: str = "0", after: str = "0") -> None:
    ppr = ensure_child(style, "w:pPr")
    spacing = ensure_child(ppr, "w:spacing")
    spacing.set(qn("w:before"), before)
    spacing.set(qn("w:after"), after)
    spacing.set(qn("w:line"), line)
    spacing.set(qn("w:lineRule"), "auto")
    jc = ensure_child(ppr, "w:jc")
    jc.set(qn("w:val"), align)
    ind = ppr.find("w:ind", NS)
    if first_line is not None:
        if ind is None:
            ind = ET.SubElement(ppr, qn("w:ind"))
        ind.set(qn("w:firstLine"), first_line)
    elif ind is not None and qn("w:firstLine") in ind.attrib:
        del ind.attrib[qn("w:firstLine")]


def main() -> None:
    src = Path("work_thesis.docx")
    dst = Path("论文初稿_精简润色排版版.docx")

    with zipfile.ZipFile(src, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    document_root = ET.fromstring(files["word/document.xml"])
    body = document_root.find("w:body", NS)
    if body is None:
        raise RuntimeError("document.xml missing body")

    paragraphs = body.findall("w:p", NS)
    texts = [paragraph_text(p) for p in paragraphs]
    ref_heading_idx = next(i for i, text in enumerate(texts) if text == "参考文献")

    for idx, paragraph in enumerate(paragraphs[:ref_heading_idx]):
        text = texts[idx]
        if idx in REPLACEMENTS:
            set_paragraph_text(paragraph, REPLACEMENTS[idx])
            text = REPLACEMENTS[idx]

        if not text:
            continue

        if idx not in REPLACEMENTS and not is_preserved_heading_or_caption(text):
            body.remove(paragraph)
            continue

        normalized_text = paragraph_text(paragraph)
        if normalized_text.startswith("第六章") or CHAPTER_RE.match(normalized_text):
            set_paragraph_style(paragraph, "2")
        elif SUBSECTION_RE.match(normalized_text):
            set_paragraph_style(paragraph, "4")
        elif SECTION_RE.match(normalized_text) or normalized_text in {"结束语", "参考文献"}:
            set_paragraph_style(paragraph, "3")
        elif CAPTION_RE.match(normalized_text):
            set_paragraph_style(paragraph, "6")

    paragraphs = body.findall("w:p", NS)
    texts = [paragraph_text(p) for p in paragraphs]
    ref_heading_idx = next(i for i, text in enumerate(texts) if text == "参考文献")

    citation_order = collect_citation_order(texts, ref_heading_idx)
    mapping = {old: new for new, old in enumerate(citation_order, start=1)}

    for paragraph in paragraphs[:ref_heading_idx]:
        for t in paragraph.findall(".//w:t", NS):
            if t.text:
                t.text = transform_citation_text(t.text, mapping)

    ref_paragraph_by_old_num: dict[int, ET.Element] = {}
    for paragraph in paragraphs[ref_heading_idx + 1 :]:
        text = paragraph_text(paragraph)
        match = REF_LINE_RE.match(text)
        if match:
            ref_paragraph_by_old_num[int(match.group(1))] = paragraph

    new_ref_paragraphs: list[ET.Element] = []
    for old_num in citation_order:
        original = ref_paragraph_by_old_num.get(old_num)
        if original is None:
            raise RuntimeError(f"Missing bibliography entry [{old_num}]")
        paragraph = copy.deepcopy(original)
        first_text = paragraph.find(".//w:t", NS)
        if first_text is None or first_text.text is None:
            raise RuntimeError(f"Invalid bibliography entry [{old_num}]")
        first_text.text = REF_LINE_RE.sub(f"[{mapping[old_num]}]", first_text.text, count=1)
        new_ref_paragraphs.append(paragraph)

    body_children = list(body)
    heading_elem = paragraphs[ref_heading_idx]
    heading_pos = body_children.index(heading_elem)
    sect_pr = body.find("w:sectPr", NS)

    for child in list(body)[heading_pos + 1 :]:
        if sect_pr is not None and child is sect_pr:
            continue
        body.remove(child)

    insert_pos = heading_pos + 1
    for paragraph in new_ref_paragraphs:
        body.insert(insert_pos, paragraph)
        insert_pos += 1

    styles_root = ET.fromstring(files["word/styles.xml"])
    style_map = {
        style.get(qn("w:styleId")): style
        for style in styles_root.findall(".//w:style", NS)
        if style.get(qn("w:type")) == "paragraph"
    }

    normal_style = style_map.get("1")
    if normal_style is not None:
        set_run_style(normal_style, "宋体", "Times New Roman", "24", bold=False)
        set_paragraph_style_props(normal_style, first_line="420", align="both", line="360")

    heading1 = style_map.get("2")
    if heading1 is not None:
        set_run_style(heading1, "黑体", "Times New Roman", "32", bold=True)
        set_paragraph_style_props(heading1, first_line=None, align="center", line="360", before="240", after="120")

    heading2 = style_map.get("3")
    if heading2 is not None:
        set_run_style(heading2, "黑体", "Times New Roman", "28", bold=True)
        set_paragraph_style_props(heading2, first_line=None, align="left", line="360", before="200", after="80")

    heading3 = style_map.get("4")
    if heading3 is not None:
        set_run_style(heading3, "黑体", "Times New Roman", "24", bold=True)
        set_paragraph_style_props(heading3, first_line=None, align="left", line="360", before="120", after="60")

    heading4 = style_map.get("5")
    if heading4 is not None:
        set_run_style(heading4, "黑体", "Times New Roman", "24", bold=True)
        set_paragraph_style_props(heading4, first_line=None, align="left", line="360", before="80", after="40")

    caption = style_map.get("6")
    if caption is not None:
        set_run_style(caption, "宋体", "Times New Roman", "21", bold=False)
        set_paragraph_style_props(caption, first_line=None, align="center", line="300", before="60", after="60")

    sect = document_root.find(".//w:sectPr", NS)
    if sect is not None:
        pg_sz = ensure_child(sect, "w:pgSz")
        pg_sz.set(qn("w:w"), "11906")
        pg_sz.set(qn("w:h"), "16838")
        pg_mar = ensure_child(sect, "w:pgMar")
        for key, value in {
            "top": "1440",
            "right": "1440",
            "bottom": "1440",
            "left": "1440",
            "header": "720",
            "footer": "720",
            "gutter": "0",
        }.items():
            pg_mar.set(qn(f"w:{key}"), value)

    files["word/document.xml"] = ET.tostring(document_root, encoding="utf-8", xml_declaration=True)
    files["word/styles.xml"] = ET.tostring(styles_root, encoding="utf-8", xml_declaration=True)

    with zipfile.ZipFile(dst, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, data in files.items():
            zout.writestr(name, data)

    with zipfile.ZipFile(dst) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    final_texts = [
        paragraph_text(p)
        for p in root.findall(".//w:body/w:p", NS)
        if paragraph_text(p)
    ]
    final_chars = len(re.sub(r"\s+", "", "\n".join(final_texts)))
    print("used_refs:", citation_order)
    print("final_ref_count:", len(citation_order))
    print("final_chars_no_space:", final_chars)
    print("output:", dst.resolve())


if __name__ == "__main__":
    main()
