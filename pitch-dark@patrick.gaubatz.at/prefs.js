// -*- mode: js2; indent-tabs-mode: nil; js2-basic-offset: 4 -*-
// Start apps on custom workspaces

const GdkPixbuf = imports.gi.GdkPixbuf;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const GMenu = imports.gi.GMenu;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Mainloop = imports.mainloop;

const Gettext = imports.gettext.domain('gnome-shell-extensions');
const _ = Gettext.gettext;
const N_ = function (e) { return e };

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

const SETTINGS_APPLICATION_LIST = 'application-list';
const SETTINGS_MODE = 'mode';

const MODES = {
    'all': N_("All applications"),
    'whitelist': N_("Applications listed below (whitelist)"),
    'blacklist': N_("Applications not listed below (blacklist)"),
};

const Columns = {
	APPINFO: 0,
	DISPLAY_NAME: 1,
	ICON: 2
};

const Widget = new GObject.Class({
	Name: 'PitchDark.Prefs.Widget',
	GTypeName: 'PitchDarkPrefsWidget',
	Extends: Gtk.Grid,

	_init: function (params) {
		this.parent(params);

		this.set_orientation(Gtk.Orientation.VERTICAL);

		this._settings = Convenience.getSettings();
		this._settings.connect('changed', Lang.bind(this, this._refresh));
		this._changedPermitted = false;

		this._store = new Gtk.ListStore();
		this._store.set_column_types([Gio.AppInfo, GObject.TYPE_STRING, Gio.Icon, GObject.TYPE_INT,
			Gtk.Adjustment]);

		let presentLabel = '<b>' + _("Apply dark theme to") + '</b>';
        this.add(new Gtk.Label({
			label: presentLabel, use_markup: true,
			halign: Gtk.Align.START
		}));

        let align = new Gtk.Alignment({ left_padding: 12, bottom_padding: 12, top_padding: 6 });
        this.add(align);

        let grid = new Gtk.Grid({
			orientation: Gtk.Orientation.VERTICAL,
			row_spacing: 6,
			column_spacing: 6
		});
        align.add(grid);

		let radio = null;
        let currentMode = this._settings.get_string(SETTINGS_MODE);
        for (let mode in MODES) {
            // copy the mode variable because it has function scope, not block scope
            // so cannot be used in a closure
            let modeCapture = mode;
            let name = Gettext.gettext(MODES[mode]);

            radio = new Gtk.RadioButton({ group: radio, label: name, valign: Gtk.Align.START });
            radio.connect('toggled', Lang.bind(this, function (widget) {
                if (widget.active) {
                    this._settings.set_string(SETTINGS_MODE, modeCapture);
					this._treeView.sensitive = modeCapture !== "all";
					this._toolbar.sensitive = modeCapture !== "all";
				}
            }));
            grid.add(radio);

            if (mode == currentMode) {
                radio.active = true;
			}
        }

		let scrolled = new Gtk.ScrolledWindow({ shadow_type: Gtk.ShadowType.IN });
		scrolled.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
		this.add(scrolled);

		this._treeView = new Gtk.TreeView({
			model: this._store, hexpand: true, vexpand: true
		});
		this._treeView.get_selection().set_mode(Gtk.SelectionMode.SINGLE);

		let appColumn = new Gtk.TreeViewColumn({
			expand: true, sort_column_id: Columns.DISPLAY_NAME,
			title: _("Application")
		});
		let iconRenderer = new Gtk.CellRendererPixbuf;
		appColumn.pack_start(iconRenderer, false);
		appColumn.add_attribute(iconRenderer, "gicon", Columns.ICON);
		let nameRenderer = new Gtk.CellRendererText;
		appColumn.pack_start(nameRenderer, true);
		appColumn.add_attribute(nameRenderer, "text", Columns.DISPLAY_NAME);
		this._treeView.append_column(appColumn);

		scrolled.add(this._treeView);

		this._toolbar = new Gtk.Toolbar({ icon_size: Gtk.IconSize.SMALL_TOOLBAR });
		this._toolbar.get_style_context().add_class(Gtk.STYLE_CLASS_INLINE_TOOLBAR);
		this.add(this._toolbar);

		let newButton = new Gtk.ToolButton({
			icon_name: 'list-add-symbolic', label: _("Add"),
			is_important: true
		});
		newButton.connect('clicked', Lang.bind(this, this._createNew));
		this._toolbar.add(newButton);

		let delButton = new Gtk.ToolButton({ icon_name: 'edit-delete-symbolic' });
		delButton.connect('clicked', Lang.bind(this, this._deleteSelected));
		this._toolbar.add(delButton);

		let selection = this._treeView.get_selection();
		selection.connect('changed',
			function () {
				delButton.sensitive = selection.count_selected_rows() > 0;
			});
		delButton.sensitive = selection.count_selected_rows() > 0;

		this._changedPermitted = true;
		this._refresh();
	},

	_createNew: function () {
		let dialog = new Gtk.Dialog({
			title: _("Create new matching rule"),
			transient_for: this.get_toplevel(),
			use_header_bar: true,
			modal: true
		});
		dialog.add_button(Gtk.STOCK_CANCEL, Gtk.ResponseType.CANCEL);
		let addButton = dialog.add_button(_("Add"), Gtk.ResponseType.OK);
		dialog.set_default_response(Gtk.ResponseType.OK);

		dialog._appChooser = new Gtk.AppChooserWidget({ show_all: true });
		dialog._appChooser.connect('application-selected', Lang.bind(this,
			function (w, appInfo) {
				addButton.sensitive = appInfo &&
					this._checkId(appInfo.get_id());
			}));
		let appInfo = dialog._appChooser.get_app_info();
		addButton.sensitive = appInfo && this._checkId(appInfo.get_id());

		dialog.get_content_area().add(dialog._appChooser);

		dialog.connect('response', Lang.bind(this, function (dialog, id) {
			if (id != Gtk.ResponseType.OK) {
				dialog.destroy();
				return;
			}

			let appInfo = dialog._appChooser.get_app_info();
			if (!appInfo)
				return;

			this._changedPermitted = false;
			this._appendItem(appInfo.get_id());
			this._changedPermitted = true;

			let iter = this._store.append();

			this._store.set(iter,
				[Columns.APPINFO, Columns.ICON, Columns.DISPLAY_NAME],
				[appInfo, appInfo.get_icon(), appInfo.get_display_name()]);

			dialog.destroy();
		}));
		dialog.show_all();
	},

	_deleteSelected: function () {
		let [any, model, iter] = this._treeView.get_selection().get_selected();

		if (any) {
			let appInfo = this._store.get_value(iter, Columns.APPINFO);

			this._changedPermitted = false;
			this._removeItem(appInfo.get_id());
			this._changedPermitted = true;
			this._store.remove(iter);
		}
	},

	_refresh: function () {
		if (!this._changedPermitted)
			// Ignore this notification, model is being modified outside
			return;

		this._store.clear();

		let currentMode = this._settings.get_string(SETTINGS_MODE);
		this._treeView.sensitive = currentMode !== "all";
		this._toolbar.sensitive = currentMode !== "all";

		let currentItems = this._settings.get_strv(SETTINGS_APPLICATION_LIST);
		let validItems = [];
		for (let i = 0; i < currentItems.length; i++) {
			let [id, index] = currentItems[i].split(':');
			let appInfo = Gio.DesktopAppInfo.new(id);
			if (!appInfo)
				continue;
			validItems.push(currentItems[i]);

			let iter = this._store.append();
			this._store.set(iter,
				[Columns.APPINFO, Columns.ICON, Columns.DISPLAY_NAME],
				[appInfo, appInfo.get_icon(), appInfo.get_display_name()]);
		}

		if (validItems.length != currentItems.length) // some items were filtered out
			this._settings.set_strv(SETTINGS_APPLICATION_LIST, validItems);
	},

	_checkId: function (id) {
		let items = this._settings.get_strv(SETTINGS_APPLICATION_LIST);
		return !items.some(function (i) { return i.startsWith(id + ':'); });
	},

	_appendItem: function (id) {
		let currentItems = this._settings.get_strv(SETTINGS_APPLICATION_LIST);
		currentItems.push(id);
		this._settings.set_strv(SETTINGS_APPLICATION_LIST, currentItems);
	},

	_removeItem: function (id) {
		let currentItems = this._settings.get_strv(SETTINGS_APPLICATION_LIST);
		let index = currentItems.indexOf(id);

		if (index < 0)
			return;
		currentItems.splice(index, 1);
		this._settings.set_strv(SETTINGS_APPLICATION_LIST, currentItems);
	},

	_changeItem: function (id) {
		let currentItems = this._settings.get_strv(SETTINGS_APPLICATION_LIST);
		let index = currentItems.indexOf(id);

		if (index < 0)
			currentItems.push(id);
		else
			currentItems[index] = id;
		this._settings.set_strv(SETTINGS_APPLICATION_LIST, currentItems);
	}
});


function init() {
	Convenience.initTranslations();
}

function buildPrefsWidget() {
	let widget = new Widget({ margin: 12 });
	widget.show_all();

	return widget;
}