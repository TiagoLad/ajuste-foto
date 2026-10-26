# Publicação e cache

Antes de publicar uma alteração, execute na pasta do projeto:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\atualizar-versoes.ps1
```

A opção `-ExecutionPolicy Bypass` vale somente para esse processo do PowerShell;
não altera a política permanente do Windows.

O script calcula o SHA-256 do JavaScript, CSS, logo e ícones e atualiza suas
referências no HTML, por exemplo `styles.css?v=9ec6b2b4a101`.
Somente arquivos que mudaram recebem uma nova versão. Não há botão de atualização,
parâmetro baseado em horário ou limpeza do cache dos modelos de IA.

Publique os arquivos estáticos primeiro e o `index.html` atualizado por último.
Uma página já aberta precisa ser recarregada para receber a nova interface.

## Configuração do servidor

Para garantir que o navegador encontre a versão nova, configure os cabeçalhos HTTP:

| Recurso | Cache-Control |
| --- | --- |
| HTML, incluindo a rota `/` | `no-cache` |
| JS, CSS e imagens com `?v=...` | `public, max-age=31536000, immutable` |

`no-cache` permite guardar o HTML, mas exige revalidação antes de reutilizá-lo.
O servidor deve considerar o parâmetro `v` na chave de cache, inclusive se houver CDN.
Não aplique cache imutável a versões sem `?v=...`.

Esses cabeçalhos dependem da hospedagem; não são definidos por JavaScript ou pelas
tags de versão. Nenhuma configuração de um servidor específico foi imposta pelo projeto.
