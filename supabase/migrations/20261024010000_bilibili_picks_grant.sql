-- 补上 bilibili_picks 的表权限（上一个迁移漏了）：
-- 新建的表默认登录用户也不能碰，要明确 grant；能看、能写哪些行再由 RLS 决定（只有成员）
grant select, insert, update on public.bilibili_picks to authenticated;
