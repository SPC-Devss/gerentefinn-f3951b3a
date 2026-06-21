import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, Lock, Database, UserX, Mail, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/trust")({
  head: () => ({
    meta: [
      { title: "Confiança e Privacidade — Finn" },
      {
        name: "description",
        content:
          "Como o Finn cuida da segurança, da privacidade e dos seus dados financeiros pessoais.",
      },
      { property: "og:title", content: "Confiança e Privacidade — Finn" },
      {
        property: "og:description",
        content:
          "Como o Finn cuida da segurança, da privacidade e dos seus dados financeiros pessoais.",
      },
    ],
  }),
  component: TrustPage,
});

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof ShieldCheck;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card/40 p-6 backdrop-blur">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      </div>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function TrustPage() {
  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar ao início
        </Link>

        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Confiança e Privacidade
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Esta página é mantida pela equipe do Finn para responder dúvidas comuns sobre
            segurança e privacidade. É conteúdo editável do produto, não uma certificação
            independente.
          </p>
        </header>

        <div className="space-y-4">
          <Section icon={ShieldCheck} title="Autenticação e acesso">
            <p>
              O acesso à sua conta exige autenticação por e-mail e senha. Cada usuário só
              enxerga seus próprios dados — o isolamento é aplicado no banco de dados por
              políticas de segurança em nível de linha (RLS), e não apenas pela interface.
            </p>
          </Section>

          <Section icon={Lock} title="Transporte e armazenamento">
            <p>
              Todo tráfego entre o navegador e o backend usa HTTPS. Os dados ficam
              armazenados em infraestrutura gerenciada pelo Lovable Cloud (Postgres),
              hospedada por provedores que aplicam criptografia em repouso na camada de
              disco. Segredos do servidor (chaves de API, tokens) não são expostos ao
              cliente.
            </p>
          </Section>

          <Section icon={Database} title="Dados que coletamos">
            <p>
              Coletamos apenas o necessário para o produto funcionar: e-mail de login,
              contas e cartões que você cadastra, lançamentos, categorias, metas e
              orçamentos. Não vendemos seus dados nem os compartilhamos com anunciantes.
            </p>
            <p>
              O Finn não se conecta diretamente aos seus bancos: você importa extratos
              (CSV, OFX ou PDF) ou registra lançamentos manualmente. Não armazenamos
              credenciais bancárias.
            </p>
          </Section>

          <Section icon={UserX} title="Exclusão de conta e LGPD">
            <p>
              Você pode excluir sua conta a qualquer momento pela tela de Configurações.
              A exclusão remove seu perfil e todos os dados associados (contas, cartões,
              lançamentos, faturas, parcelas, metas, orçamentos, recorrências, categorias
              e histórico de conversas) de forma definitiva.
            </p>
          </Section>

          <Section icon={Mail} title="Contato">
            <p>
              Dúvidas sobre privacidade, exclusão de dados ou incidentes de segurança
              podem ser enviadas para o responsável pelo aplicativo através do canal de
              suporte informado dentro do produto.
            </p>
          </Section>
        </div>

        <p className="mt-8 text-xs text-muted-foreground">
          Este documento descreve práticas atuais do Finn e pode ser atualizado conforme
          o produto evolui. Ele não constitui termo legal nem certificação de
          conformidade.
        </p>
      </div>
    </div>
  );
}
