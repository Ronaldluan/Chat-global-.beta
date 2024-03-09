<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mensageiro Seguro</title>
<style>
  body { font-family: Arial, sans-serif; }
  .mensagem { background-color: #f4f4f4; margin-bottom: 10px; padding: 10px; border-radius: 5px; }
  .enviar { background-color: #4CAF50; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; }
  .enviar:hover { background-color: #45a049; }
  .personalizacao { margin-bottom: 10px; }
  #mensagens { border: 1px solid #ccc; padding: 10px; height: 150px; overflow-y: scroll; }
</style>
</head>
<body>

<div id="app">
  <div class="personalizacao">
    <label for="nome">Seu nome:</label>
    <input type="text" id="nome" placeholder="Digite seu nome" onblur="bloquearNome()">
    <label for="cor">Escolha uma cor:</label>
    <input type="color" id="cor" onchange="alterarCor()">
  </div>

  <div id="mensagens">
    <!-- As mensagens enviadas aparecerão aqui -->
  </div>

  <div class="mensagem">
    <input type="text" id="mensagem" placeholder="Digite sua mensagem">
    <button class="enviar" onclick="enviarMensagem()">Enviar Mensagem</button>
  </div>
</div>

<script>
  function bloquearNome() {
    document.getElementById('nome').disabled = true;
  }

  function alterarCor() {
    var cor = document.getElementById('cor').value;
    document.body.style.backgroundColor = cor;
  }

  function enviarMensagem() {
    var nome = document.getElementById('nome').value;
    var mensagem = document.getElementById('mensagem').value;
    var mensagens = document.getElementById('mensagens');
    var novaMensagem = document.createElement('div');
    novaMensagem.classList.add('mensagem');
    novaMensagem.textContent = nome + ': ' + mensagem;
    mensagens.appendChild(novaMensagem);
    document.getElementById('mensagem').value = ''; // Limpa o campo de mensagem
  }
</script>

</body>
</html>
