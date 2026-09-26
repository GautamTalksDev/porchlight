import CgiWorkbench from "@/components/cgi/CgiWorkbench";
import { Brand } from "@/components/ui/Brand";

export const metadata = { title: "Porchlight for utilities, the CGI case" };

export default function CgiPage() {
  return (
    <>
      <header className="shell-bar">
        <Brand />
        <nav className="shell-nav" aria-label="Sections">
          <a className="btn btn-quiet btn-small" href="/ops">Operations room</a>
          <a className="btn btn-quiet btn-small" href="/cgi" aria-current="page">Utility case (CGI)</a>
          <a className="btn btn-quiet btn-small" href="/present">Story mode</a>
        </nav>
      </header>
      <CgiWorkbench />
    </>
  );
}
