
window.onload = function() {

  var location = $("#h_location").val();
  var src= "https://datastudio.google.com/embed/reporting/be4ab638-e565-4fe4-944d-2a16e09e7ebb/page/ccacC?params=%7B%22df6%22:%22include%25EE%2580%25800%25EE%2580%2580EQ%25EE%2580%2580LOCATION%22%7D";
  var url = src.replace("LOCATION", location);
  document.getElementById('giFrame').src=url;

}