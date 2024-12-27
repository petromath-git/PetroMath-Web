function renderTable(array,tabletitle,numberColumns = [],tableWidthClass = '') {
    var result = "<div class='card' style='margin-bottom: 10px;'>"; // Start card container
            result += "<div class='card-header text-center font-weight-bold' >"+tabletitle+"</div>"; // Card header
            result += "<div class='card-body " + tableWidthClass + "' style='padding-bottom: 10px;'>"; // Card body with optional width class
            result += "<table class='table table-bordered table-sm' style='width: 100%; border: 1px solid #000;'>"; // Darker border for the table                                       
    
     // If the array is not empty, add headers from the keys of the first object
    if (array.length > 0 && typeof array[0] === 'object') {
        result += "<thead class='thead-light text-center'><tr>";
        Object.keys(array[0]).forEach(key => {                       
            result += "<th style='border: 1px solid #000;'>" + key + "</th>"; // Darker border for headers
        });
        result += "</tr></thead>";
    }

    // Loop through the array to build table rows
    result += "<tbody>";
    
    for (var i = 0; i < array.length; i++) {



        let rowClass = '';  // Default row class (no styling)

        // Check if it's the last row and contains "Total"
        if (i === array.length - 1) {
            // Check if it's the last row and contains "Total" or "Excess"
            let isTotalRow = Object.values(array[i]).some(value => value && 
                (value.toString().toLowerCase().includes("total") || value.toString().toLowerCase().includes("excess"))
             );

            if (isTotalRow) {
                rowClass = 'font-weight-bold text-danger'; // Apply bold and red color for "Total" row
            }
        }


        result += "<tr>";                   
         Object.keys(array[i]).forEach(key => {
            let dataValue = array[i][key];   

         
         
           // Check if the current column should be formatted as a number
            if (numberColumns.includes(key) && dataValue !== "" &&!isNaN(dataValue))
            {
             
                printedValue = new Intl.NumberFormat('en-IN', {
                                                    style: 'decimal',                                                                
                                                    minimumFractionDigits:2,
                                                    maximumFractionDigits:2	
                                                }).format(dataValue); 

                result += "<td class='" + rowClass + " text-right' style='border: 1px solid #000;'>" + printedValue + "</td>"; // Darker border for cells                                                    
            }
            else
                result += "<td class='" + rowClass + " text-left' style='border: 1px solid #000;'>" + dataValue + "</td>"; // Darker border for cells
         });
        result += "</tr>";
    }
    result += "</tbody>";
    result += "</table>";
    result += "</div>"; // Close card body
    result += "</div>"; // Close card container
    return result;
}

function renderTransposedTable(array,tabletitle,numberColumns = [],tableWidthClass='') {

     var result = "<div class='card' style='margin-bottom: 10px;'>"; // Start card container
            result += "<div class='card-header text-center font-weight-bold'>"+tabletitle+"</div>"; // Card header
            result += "<div class='card-body " + tableWidthClass + "' style='padding-bottom: 10px;'>"; // Card body with optional width class
            result += "<table class='table table-bordered table-sm' style='width: 100%; border: 1px solid #000;'>"; // Darker border for the table
            result += "<tbody>"; 

    

    // Loop through the array to transpose data into rows
    
    Object.keys(array[0]).forEach(key => {
       
                    result += "<td class='font-weight-bold' style='background-color: #f7f7f7; border: 1px solid #000;'>" + key + "</td>"; // Bold first column with grey background

                    array.forEach((item, index) => {
                        let rowClass = ''; // Default row class (no styling)

                        
                       

                        // Check if the current item in the last row contains "Total", "Excess", or "Shortage"
                        let itemValue = item[key];                                  
                         

                        if (key && 
                            (key.toString().toLowerCase().includes("total") || 
                            key.toString().toLowerCase().includes("excess") || 
                            key.toString().toLowerCase().includes("shortage"))) {
                            rowClass = 'font-weight-bold text-danger'; // Apply bold and red color for "Total", "Excess", or "Shortage"
                        }


                        if (numberColumns.includes(key) && itemValue !== "" &&!isNaN(itemValue)) {
                        // Format as a number with commas and fixed decimal places
                                itemValue = new Intl.NumberFormat('en-IN', {
                                    style: 'decimal',
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2
                                }).format(itemValue);
                         }




                // Add the value to the table cell with the appropriate class
                result += "<td class='" + rowClass + " text-right' style='border: 1px solid #000;'>" + (itemValue || '') + "</td>";
            });

            result += "</tr>";
        });

    result += "</tbody>";
    result += "</table>";
    result += "</div>"; // Close card body
    result += "</div>"; // Close card container
    return result;
}     