# 智慧夜市空间信息可视化平台

基于开题报告《基于 Leaflet 与 Flask 的智慧夜市空间信息可视化平台设计与实现》构建的项目初始化版本。

## 项目结构

- `backend/` Flask 后端接口
- `frontend/` Leaflet 前端页面
- `data/` 示例业务数据（摊位与审核提交）
- `docs/requirements.md` 需求整理文档

## 快速运行

1. 创建并激活 Python 虚拟环境（可选）。
2. 安装依赖：`pip install -r requirements.txt`
3. 启动后端：`python backend/app.py`
4. 浏览器打开：`frontend/index.html`

后端默认地址：`http://127.0.0.1:5000`

## 已实现能力

- 普通用户：地图浏览、摊位详情、热力图切换
- 商户：提交新增/修改申请（待管理员审核）
- 管理员：查看待审核并通过，写回主数据

## 说明

当前版本为毕业设计阶段的可运行原型，数据存储采用 JSON 文件，后续可替换为关系型数据库。
