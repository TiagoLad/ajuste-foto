/*
 * Integração para a página upload_crop.php da FUNDASP.
 * Substitua o bloco JavaScript que define preview() e inicializa imgAreaSelect
 * por este arquivo. Ele depende dos mesmos jQuery e imgAreaSelect do portal.
 * Não deve ser carregado no index.html do ajustador.
 * Não envia a foto: o usuário continua clicando em "Salvar 3x4".
 */
(function ($) {
  'use strict';

  var previewWidth = 354;
  var previewHeight = 472;

  function preview(img, selection) {
    if (!selection.width || !selection.height) return;
    var scaleX = previewWidth / selection.width;
    var scaleY = previewHeight / selection.height;

    // The portal reuses id="thumbnail" for the image and the form.
    // Specify the element type so only the photo is selected.
    $('img#thumbnail + div > img').css({
      width: Math.round(scaleX * img.width) + 'px',
      height: Math.round(scaleY * img.height) + 'px',
      marginLeft: -Math.round(scaleX * selection.x1) + 'px',
      marginTop: -Math.round(scaleY * selection.y1) + 'px'
    });

    $.each(['x1', 'y1', 'x2', 'y2', 'width', 'height'], function (_, key) {
      var field = key === 'width' ? 'w' : key === 'height' ? 'h' : key;
      $('#' + field).val(selection[key]);
    });
  }

  function initialSelection(width, height) {
    // Integer multiples of 3 and 4 preserve the exact ratio without exceeding
    // the displayed image. A 600x800 photo selects the complete image.
    var unit = Math.floor(Math.min(width / 3, height / 4));
    if (unit < 1) return null;
    var cropWidth = unit * 3;
    var cropHeight = unit * 4;
    var x1 = Math.floor((width - cropWidth) / 2);
    var y1 = Math.floor((height - cropHeight) / 2);
    return {
      x1: x1, y1: y1,
      x2: x1 + cropWidth, y2: y1 + cropHeight,
      width: cropWidth, height: cropHeight
    };
  }

  $(function () {
    var img = $('img#thumbnail')[0];
    if (!img) return;

    function initialize() {
      if (!img.naturalWidth) return;
      var selection = initialSelection(img.width, img.height);
      if (!selection) return;
      $(img).imgAreaSelect({
        aspectRatio: '3:4',
        x1: selection.x1, y1: selection.y1,
        x2: selection.x2, y2: selection.y2,
        handles: true,
        onSelectChange: preview
      });
      // Initializing the rectangle does not necessarily fire onSelectChange.
      // Fill the preview and hidden coordinates before the first mouse action.
      preview(img, selection);
    }

    if (img.complete) initialize();
    else $(img).one('load', initialize);

    $('#save_thumb').click(function () {
      var valid = true;
      $.each(['x1', 'y1', 'x2', 'y2', 'w', 'h'], function (_, field) {
        var value = $('#' + field).val();
        if (value === '' || !isFinite(Number(value))) valid = false;
      });
      if (Number($('#w').val()) <= 0 || Number($('#h').val()) <= 0) valid = false;
      if (!valid) alert('Selecione o recorte da foto antes de salvar.');
      return valid;
    });
  });
})(jQuery);
