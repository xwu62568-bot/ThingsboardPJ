import { LogoutButton } from "@/components/logout-button";
import { useWorkspace } from "@/components/workspace-provider";

export function AccountPage() {
  const { session } = useWorkspace();

  return (
    <main className="workspacePage">
      <section className="accountLayout">
        <article className="workspacePanel accountProfileCard">
          <div className="accountAvatar">{getInitial(session.user.name || session.user.username)}</div>
          <div>
            <h2>{session.user.name || session.user.username}</h2>
            <p className="muted">{session.user.username}</p>
          </div>
          <LogoutButton />
        </article>

        <article className="workspacePanel">
          <div className="sectionHead">
            <h3>账号信息</h3>
          </div>
          <dl className="accountInfoList">
            <div>
              <dt>用户名</dt>
              <dd>{session.user.username}</dd>
            </div>
            <div>
              <dt>显示名称</dt>
              <dd>{session.user.name || "--"}</dd>
            </div>
            <div>
              <dt>邮箱</dt>
              <dd>{session.user.email || "--"}</dd>
            </div>
            <div>
              <dt>角色</dt>
              <dd>{session.user.role || "--"}</dd>
            </div>
            <div>
              <dt>平台地址</dt>
              <dd>{session.baseUrl}</dd>
            </div>
            <div>
              <dt>客户编号</dt>
              <dd>{session.user.customerId || "--"}</dd>
            </div>
          </dl>
        </article>
      </section>
    </main>
  );
}

function getInitial(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : "账";
}
