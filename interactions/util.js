// For modal text inputs nested inside action rows
function getTextInputValue(data, customID) {
    for (const row of data.components ?? []) {
        for (const component of row.components ?? []) {
            if (component.custom_id == customID) return component.value;
        }
    }
}

module.exports = {
    getTextInputValue
};
