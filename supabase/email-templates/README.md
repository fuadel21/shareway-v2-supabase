# Plantillas de email de ShareWay para Supabase

Estas plantillas están preparadas para pegarlas en el panel de Supabase Auth.

## Dónde se configuran

En Supabase:

1. Authentication
2. Email Templates
3. Confirm signup
4. Reset password

## Plantilla de registro

Asunto recomendado:

```text
Confirma tu cuenta en ShareWay
```

Contenido HTML:

```text
supabase/email-templates/confirm-signup.html
```

## Plantilla de recuperación de contraseña

Asunto recomendado:

```text
Recupera tu contraseña de ShareWay
```

Contenido HTML:

```text
supabase/email-templates/reset-password.html
```

## Variables usadas

Las plantillas usan variables oficiales de Supabase:

```text
{{ .ConfirmationURL }}
{{ .SiteURL }}
```

`{{ .ConfirmationURL }}` es el enlace que confirma la cuenta o permite recuperar la contraseña.

`{{ .SiteURL }}` apunta al dominio configurado en Supabase Auth.

## URLs necesarias en Supabase Auth

En Authentication > URL Configuration:

Site URL:

```text
https://www.shareway.es
```

Redirect URLs:

```text
https://www.shareway.es/**
https://shareway.es/**
```

## Flujo conectado en la app

Registro:

```text
/register -> Supabase signUp -> email de confirmación -> /dashboard
```

Recuperación de contraseña:

```text
/forgot-password -> email de recuperación -> /reset-password -> nueva contraseña -> /login
```
