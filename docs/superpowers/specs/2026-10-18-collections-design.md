# 合集（Collections）设计文档

日期：2026-10-18

## 背景与目标

「数学复习本」现有两种归类机制：

- **标签**：一条内容可挂多个标签，顶部可筛选（交集/并集）。
- **分组**：把卡片按**第一个标签**折叠显示。

用户需要一种**文件夹式**的归类：一条内容只属于一个合集，合集可嵌套（子合集）。

目标：为「错题」与「知识点」两个库各自提供一棵可嵌套的合集树，用户可以在编辑、批量多选、新增导入时给内容指定合集，并通过左侧常驻树侧栏按合集浏览与筛选。

## 范围与决策

| 决策项 | 结论 |
|---|---|
| 合集模型 | 文件夹式，一条内容只属一个合集 |
| 层级 | 支持嵌套子合集（树） |
| 库范围 | 错题库、知识点库**各自一棵树**（同名互不相干） |
| 入集方式 | 编辑时选、多选后批量移动、新增/导入时指定（不做拖拽） |
| 浏览方式 | 左侧常驻合集树侧栏；窄屏收为抽屉 |
| 与标签关系 | 并存，互不影响；现有「分组」按钮保持按首个标签分组不变 |

## 数据模型

### 条目
- 新增字段 `collectionId: string | null`（`null` = 未分类）。
- 影响 `normalizeQuestion` / `normalizeKp` / `paperWrongToQuestion`。

### 合集节点
```
{ id, name, parentId: string|null, createdAt, updatedAt }
```
不带库标记，由所在存储（q / k）区分。

### 存储
- 新增键 `mq_collections_q` / `mq_collections_k`，与 `mq_items` / `mq_kps` 并列。
- 导出/完整备份 payload 增加 `collections: { q: [...], k: [...] }`；旧备份缺该字段则忽略。

## 纯函数（lib.js，可单测）

`normalizeCollection`、`settleCollections`（修正悬空 parent、断环）、`collectionChildren`、`collectionSubtreeIds`（含自身，防环）、`collectionPath`、`flattenCollections`（带 depth）、`addCollection`、`renameCollection`、`canMoveCollection` / `moveCollection`（禁止移入自身子树）、`deleteCollection`（返回 removedIds 与 parentId）、`filterItemsByCollection`（`__all__` 全部 / `null` 未分类 / 节点含子树）、`collectionCounts`（direct + subtree + unassigned，非法引用计入未分类）、`sanitizeItemCollections`（把指向不存在合集的条目置为未分类）。

## 交互与 UI

- **左侧 `.coltree` 侧栏**：宽屏（≥1024px）常驻；窄屏为抽屉，header 加「☰ 合集」开关 + 半透明遮罩。试卷视图隐藏侧栏。
- 侧栏结构：顶部固定「全部 / 未分类」（带计数）→ 可展开折叠的合集树（名称 + 计数，选中高亮，节点 hover 出 `＋` 新建子合集 / `✎` 重命名 / `🗑` 删除）→ 底部「+ 新建合集」。
- 折叠状态与滚动位置在重渲染后保留。
- **编辑弹窗**：新增「所属合集」下拉（缩进树 + 未分类），旁边「＋ 新建」。
- **新增/导入弹窗**：新增「所属合集」下拉，作用于本批导入项。
- **多选工具栏**：新增「移动到合集」按钮。
- **卡片 meta**：显示合集小标签，点击即切换到该合集筛选。

## 筛选联动

`views[active].collectionFilter` 纳入 `currentFiltered`，因此随机一题 / 背题模式 / 打印 / 导出 Markdown 自动跟随当前合集。

## 边界处理

- 删除合集：确认后删除**整棵子树**，其中内容全部回到「未分类」，提示受影响条数。
- 同级重名：提示「已存在同名合集」，不静默创建。
- 「全部 / 未分类」为虚拟节点，不可改名或删除；空合集允许存在。
- 指向已删除合集的条目（含导入的旧数据）统一按「未分类」处理并落盘纠正。

## 测试

`test/lib.test.js` 覆盖：归一化、断环/悬空 parent、子树含环安全、`moveCollection` 拒绝进自身子树、`deleteCollection` 产出、`filterItemsByCollection` 三种口径、`collectionCounts` 计数与非法引用、`sanitizeItemCollections`。
